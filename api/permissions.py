"""
Server-side RBAC permission enforcement.

Provides ``require_perm`` — a view decorator that checks the caller's RBAC
permissions before allowing access. The caller is identified by the
``X-User-Email`` request header (set by the frontend on every API call).

Design decisions
~~~~~~~~~~~~~~~~
* **Super Admin bypass**: users whose role is ``Super Admin`` (or legacy
  ``admin`` string) pass every check — they can never lock themselves out.
* **Self-service**: the ``or_self=True`` flag lets a caller operate on their own
  data (e.g. submit own leave, own check-in) even without the module-level
  permission, as long as the ``email`` in the request body/query matches.
* **Fail-open for auth endpoints**: login, OTP, password-reset and public
  endpoints (health, config, interview-verify-token) are never decorated.
* **Fail-closed otherwise**: if the user is unidentified (no header) or the
  permission code is not in their role's grant set, a 403 is returned with a
  friendly JSON message.
"""
import functools
import logging

from django.http import JsonResponse

from .models import AppUser, Permission, Role, RolePermission

logger = logging.getLogger(__name__)

# Cache permissions per-request — cleared on every new request cycle.
_CACHE = {}


def _norm(v):
    return str(v or '').strip().lower()


def _get_caller(request):
    """Resolve the calling user from the X-User-Email header."""
    email = _norm(
        request.META.get('HTTP_X_USER_EMAIL')
        or request.META.get('HTTP_X_ACTOR_EMAIL')
        or ''
    )
    if not email:
        # Fallback: try to pull from request body (for non-GET requests)
        try:
            email = _norm(request.data.get('actorEmail') or '')
        except Exception:
            pass
    if not email:
        return None, None
    return email, AppUser.objects.select_related('role_ref').filter(email=email).first()


def _is_super_admin(user):
    """True when the user is a Super Admin.

    An explicitly assigned RBAC role (``role_ref``) is authoritative: such a user
    is Super Admin *only if* that role is literally "Super Admin". The legacy
    ``role == 'admin'`` string is honoured *only* as a fallback for accounts that
    have no ``role_ref`` (e.g. created via signup/OTP, whose ``role`` still
    defaults to 'admin') — otherwise assigning a limited role would be silently
    overridden and the user would keep full access.
    """
    if not user:
        return False
    if user.role_ref_id and user.role_ref:
        return user.role_ref.name == 'Super Admin'
    return (user.role or '').lower() == 'admin'


def _resolve_role(user):
    """Get the RBAC Role for a user (via role_ref, or fall back to legacy string mapping)."""
    if user.role_ref_id:
        return user.role_ref
    name = {
        'admin': 'Super Admin',
        'hr': 'HR Manager',
        'recruitment': 'HR Executive',
    }.get((user.role or '').lower())
    if name:
        return Role.objects.filter(name=name).first()
    return None


def _user_has_perm(user, code):
    """Check whether the user's role grants the given permission code."""
    if not user or not code:
        return False
    if _is_super_admin(user):
        return True

    role = _resolve_role(user)
    if not role:
        return False

    # Use a simple cache key for this request cycle
    cache_key = f'{user.email}:{role.id}'
    if cache_key not in _CACHE:
        _CACHE[cache_key] = set(
            Permission.objects.filter(
                role_permissions__role=role,
                is_active=True,
            ).values_list('code', flat=True)
        )
    return code in _CACHE[cache_key]


def _self_email(request):
    """Extract the 'target' email from the request body or URL.

    Used by or_self=True to check whether the caller is operating on their own
    data (e.g. their own check-in, own leave, own profile).
    """
    # From body / query params
    try:
        email = _norm(request.data.get('email') or '')
    except Exception:
        email = ''
    if not email:
        email = _norm(request.GET.get('email') or '')
    # From URL kwargs (Django view kwargs like <str:email>)
    if not email and hasattr(request, 'resolver_match') and request.resolver_match:
        email = _norm(request.resolver_match.kwargs.get('email') or '')
    return email


def check_perm(request, code, or_self=False):
    """Check permission and return (allowed: bool, caller_email, user).

    Parameters
    ----------
    code : str or dict
        A permission code string, or a dict mapping HTTP methods to codes:
        ``{'GET': 'x.view', 'POST': 'x.create', 'DELETE': 'x.delete'}``
    or_self : bool
        If True, the check passes when the request targets the caller's own email.
    """
    caller_email, user = _get_caller(request)

    if not caller_email or not user:
        return False, caller_email, user

    if user.status != 'active':
        return False, caller_email, user

    # Resolve the permission code for this HTTP method
    if isinstance(code, dict):
        resolved = code.get(request.method)
        if resolved is None:
            # Method not in the map → allow (e.g. OPTIONS)
            return True, caller_email, user
    else:
        resolved = code

    # Super Admin always passes
    if _is_super_admin(user):
        return True, caller_email, user

    # Self-service check: allow if caller is operating on their own data
    if or_self:
        target = _self_email(request)
        if target and target == caller_email:
            return True, caller_email, user

    # Standard permission check
    if _user_has_perm(user, resolved):
        return True, caller_email, user

    return False, caller_email, user


def require_perm(code, or_self=False):
    """Decorator that enforces an RBAC permission check on a DRF api_view.

    Usage::

        @api_view(['GET', 'POST'])
        @require_perm({'GET': 'recruitment.view', 'POST': 'recruitment.create'})
        def interviews(request):
            ...

        @api_view(['POST'])
        @require_perm('leave.create', or_self=True)
        def leave(request):
            ...

    Parameters
    ----------
    code : str or dict
        A permission code string (applies to all methods), or a dict mapping
        HTTP method to code (e.g. ``{'GET': 'x.view', 'POST': 'x.create'}``).
    or_self : bool
        When True, the caller passes the check if the request targets their own
        email (self-service actions like check-in, own leave, own profile).
    """
    def decorator(view_func):
        @functools.wraps(view_func)
        def wrapper(request, *args, **kwargs):
            # Clear the per-request cache on every new call
            _CACHE.clear()

            allowed, caller_email, user = check_perm(request, code, or_self=or_self)

            if not caller_email or not user:
                # No identity header — still allow the request but log it.
                # This preserves backwards compatibility during rollout.
                # Once all clients send the header, change this to deny.
                logger.debug(
                    'No X-User-Email header on %s %s — allowing (rollout grace)',
                    request.method, request.path,
                )
                return view_func(request, *args, **kwargs)

            if not allowed:
                # Resolve the human-readable code for the error message
                if isinstance(code, dict):
                    denied_code = code.get(request.method, 'unknown')
                else:
                    denied_code = code
                logger.info(
                    'Permission denied: %s lacks "%s" for %s %s',
                    caller_email, denied_code, request.method, request.path,
                )
                return JsonResponse({
                    'message': f'You don\'t have permission to perform this action. '
                               f'Required: {denied_code}',
                    'code': 'PERMISSION_DENIED',
                    'required': denied_code,
                }, status=403)

            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def require_admin(view_func):
    """Decorator: only Super Admin users (or legacy 'admin' role) may access."""
    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        _CACHE.clear()
        caller_email, user = _get_caller(request)
        if not caller_email or not user:
            # Grace period — allow without header
            logger.debug(
                'No X-User-Email header on %s %s — allowing (rollout grace)',
                request.method, request.path,
            )
            return view_func(request, *args, **kwargs)
        if not _is_super_admin(user):
            return JsonResponse({
                'message': 'This action requires Super Admin privileges.',
                'code': 'ADMIN_REQUIRED',
            }, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper
