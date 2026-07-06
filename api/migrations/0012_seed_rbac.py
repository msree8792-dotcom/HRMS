# Seed the RBAC catalogue: modules, permission groups, permissions, the five
# default roles and their permission matrix (section 4 of the RBAC design).
# Idempotent (get_or_create / bulk_create ignore_conflicts) so it is safe to
# re-run and never duplicates rows.

from django.db import migrations

MODULES = [
    ('Dashboard', 'grid', 1),
    ('Employee', 'users', 2),
    ('Attendance', 'clock', 3),
    ('Leave', 'calendar', 4),
    ('Payroll', 'wallet', 5),
    ('Recruitment', 'briefcase', 6),
    ('Reports', 'chart', 7),
    ('Settings', 'cog', 8),
]

# module -> [(code_suffix, display name)]
PERMS = {
    'Dashboard': [('view', 'View Dashboard')],
    'Employee': [('view', 'View Employee'), ('create', 'Create Employee'),
                 ('edit', 'Update Employee'), ('delete', 'Delete Employee')],
    'Attendance': [('view', 'View Attendance'), ('edit', 'Edit Attendance'),
                   ('checkinout', 'Check-in / Check-out')],
    'Leave': [('view', 'View Leave'), ('apply', 'Apply Leave'), ('edit', 'Edit Leave'),
              ('approve', 'Approve Leave'), ('reject', 'Reject Leave')],
    'Payroll': [('view', 'View Payroll'), ('generate', 'Generate Payroll'),
                ('approve', 'Approve Payroll')],
    'Recruitment': [('view', 'View Recruitment'), ('create', 'Create Recruitment'),
                    ('edit', 'Edit Recruitment'), ('delete', 'Delete Recruitment')],
    'Reports': [('view', 'View Reports'), ('export', 'Export Reports')],
    'Settings': [('view', 'View Settings'), ('manage', 'Manage Settings')],
}

ROLE_DESC = {
    'Super Admin': 'Full, unrestricted access to every module.',
    'HR Manager': 'Manages HR operations across employees, attendance, leave and payroll.',
    'HR Executive': 'Day-to-day HR tasks with create/edit access.',
    'Manager': 'Team-scoped view and leave approvals.',
    'Employee': 'Self-service access to own attendance, leave and payroll.',
}

ROLE_GRANTS = {
    'Super Admin': 'ALL',
    'HR Manager': ['dashboard.view', 'employee.view', 'employee.create', 'employee.edit',
                   'attendance.view', 'attendance.edit', 'leave.view', 'leave.edit',
                   'leave.approve', 'leave.reject', 'payroll.view', 'payroll.generate',
                   'recruitment.view', 'recruitment.create', 'recruitment.edit',
                   'reports.view', 'reports.export', 'settings.view'],
    'HR Executive': ['dashboard.view', 'employee.view', 'employee.create', 'employee.edit',
                     'attendance.view', 'attendance.edit', 'leave.view', 'leave.apply',
                     'leave.edit', 'payroll.view', 'recruitment.view', 'recruitment.create',
                     'reports.view', 'settings.view'],
    'Manager': ['dashboard.view', 'employee.view', 'attendance.view', 'leave.view',
                'leave.approve', 'payroll.view', 'recruitment.view', 'reports.view'],
    'Employee': ['dashboard.view', 'employee.view', 'attendance.view', 'attendance.checkinout',
                 'leave.view', 'leave.apply', 'payroll.view', 'reports.view', 'settings.view'],
}

# Bridge the legacy app_users.role string onto the new roles table.
LEGACY_MAP = {'admin': 'Super Admin', 'hr': 'HR Manager', 'recruitment': 'HR Executive'}


def seed(apps, schema_editor):
    Company = apps.get_model('api', 'Company')
    Module = apps.get_model('api', 'Module')
    Role = apps.get_model('api', 'Role')
    PermissionGroup = apps.get_model('api', 'PermissionGroup')
    Permission = apps.get_model('api', 'Permission')
    RolePermission = apps.get_model('api', 'RolePermission')
    AppUser = apps.get_model('api', 'AppUser')

    Company.objects.get_or_create(name='Eversoft', defaults={'is_active': True})

    mod_by_name = {}
    for name, icon, order in MODULES:
        m, _ = Module.objects.get_or_create(
            name=name, defaults={'icon': icon, 'order': order, 'is_active': True})
        mod_by_name[name] = m

    perm_by_code = {}
    for name, _icon, _order in MODULES:
        grp, _ = PermissionGroup.objects.get_or_create(
            name=name + ' Group',
            defaults={'module': mod_by_name[name], 'description': name + ' permissions',
                      'is_active': True})
        if grp.module_id is None:
            grp.module = mod_by_name[name]
            grp.save(update_fields=['module'])
        for suffix, pname in PERMS[name]:
            code = name.lower() + '.' + suffix
            p, _ = Permission.objects.get_or_create(
                code=code, defaults={'name': pname, 'group': grp, 'is_active': True})
            if p.group_id is None:
                p.group = grp
                p.save(update_fields=['group'])
            perm_by_code[code] = p

    all_codes = list(perm_by_code.keys())
    for rname, grants in ROLE_GRANTS.items():
        role, _ = Role.objects.get_or_create(
            name=rname, defaults={'description': ROLE_DESC.get(rname, ''), 'is_active': True})
        codes = all_codes if grants == 'ALL' else grants
        have = set(RolePermission.objects.filter(role=role).values_list('permission__code', flat=True))
        to_add = [RolePermission(role=role, permission=perm_by_code[c])
                  for c in codes if c in perm_by_code and c not in have]
        if to_add:
            RolePermission.objects.bulk_create(to_add, ignore_conflicts=True)

    roles_by_name = {r.name: r for r in Role.objects.all()}
    for legacy, rolename in LEGACY_MAP.items():
        r = roles_by_name.get(rolename)
        if r:
            AppUser.objects.filter(role=legacy, role_ref__isnull=True).update(role_ref=r)


def unseed(apps, schema_editor):
    # Non-destructive rollback: leave catalogue data in place.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_company_module_appuser_company_permissiongroup_and_more'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
