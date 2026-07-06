from django.core.management.base import BaseCommand
from django.db import transaction
from api.models import Module, PermissionGroup, Permission, Role, RolePermission, AppUser

class Command(BaseCommand):
    help = 'Seeds default Modules, Permission Groups, Permissions, and Roles for RBAC.'

    def handle(self, *args, **options):
        self.stdout.write("Seeding RBAC default data...")
        with transaction.atomic():
            # 1. Modules
            modules_data = [
                {'name': 'Dashboard', 'icon': 'dashboard', 'order': 1},
                {'name': 'Recruitment', 'icon': 'briefcase', 'order': 2},
                {'name': 'Employees', 'icon': 'users', 'order': 3},
                {'name': 'Attendance', 'icon': 'clock', 'order': 4},
                {'name': 'Leave', 'icon': 'calendar', 'order': 5},
                {'name': 'Payroll', 'icon': 'credit-card', 'order': 6},
                {'name': 'Settings', 'icon': 'settings', 'order': 7},
                {'name': 'RBAC', 'icon': 'shield', 'order': 8},
            ]
            modules = {}
            for m_info in modules_data:
                m, created = Module.objects.get_or_create(
                    name=m_info['name'],
                    defaults={'icon': m_info['icon'], 'order': m_info['order'], 'is_active': True}
                )
                modules[m_info['name']] = m
                if created:
                    self.stdout.write(f"  Created Module: {m.name}")

            # 2. Permission Groups
            groups_data = [
                {'name': 'Recruitment Group', 'module': 'Recruitment', 'desc': 'Manage jobs, candidates, and interviews'},
                {'name': 'Employee Group', 'module': 'Employees', 'desc': 'Manage employee records and tasks'},
                {'name': 'Attendance Group', 'module': 'Attendance', 'desc': 'Track and edit attendance logs'},
                {'name': 'Leave Group', 'module': 'Leave', 'desc': 'Create, view, and approve/decline leave requests'},
                {'name': 'Payroll Group', 'module': 'Payroll', 'desc': 'Manage employee salaries and payslips'},
                {'name': 'Settings Group', 'module': 'Settings', 'desc': 'Manage general settings and credentials'},
                {'name': 'RBAC Group', 'module': 'RBAC', 'desc': 'Manage roles, permissions, and user access'},
            ]
            groups = {}
            for g_info in groups_data:
                g, created = PermissionGroup.objects.get_or_create(
                    name=g_info['name'],
                    defaults={
                        'module': modules[g_info['module']],
                        'description': g_info['desc'],
                        'is_active': True
                    }
                )
                groups[g_info['name']] = g
                if created:
                    self.stdout.write(f"  Created Permission Group: {g.name}")

            # 3. Permissions
            perms_data = [
                # Recruitment
                {'name': 'View Recruitment', 'code': 'recruitment.view', 'group': 'Recruitment Group'},
                {'name': 'Create Jobs/Interviews', 'code': 'recruitment.create', 'group': 'Recruitment Group'},
                {'name': 'Edit Jobs/Interviews', 'code': 'recruitment.edit', 'group': 'Recruitment Group'},
                {'name': 'Delete Jobs/Interviews', 'code': 'recruitment.delete', 'group': 'Recruitment Group'},
                # Employees
                {'name': 'View Employee Data', 'code': 'employee.view', 'group': 'Employee Group'},
                {'name': 'Create Employee/Tasks', 'code': 'employee.create', 'group': 'Employee Group'},
                {'name': 'Edit Employee/Tasks', 'code': 'employee.edit', 'group': 'Employee Group'},
                {'name': 'Delete Employee/Tasks', 'code': 'employee.delete', 'group': 'Employee Group'},
                # Attendance
                {'name': 'View Attendance Logs', 'code': 'attendance.view', 'group': 'Attendance Group'},
                {'name': 'Create Attendance Log', 'code': 'attendance.create', 'group': 'Attendance Group'},
                {'name': 'Edit Attendance Log', 'code': 'attendance.edit', 'group': 'Attendance Group'},
                {'name': 'Delete Attendance Log', 'code': 'attendance.delete', 'group': 'Attendance Group'},
                # Leave
                {'name': 'View Leave Requests', 'code': 'leave.view', 'group': 'Leave Group'},
                {'name': 'Create Leave Request', 'code': 'leave.create', 'group': 'Leave Group'},
                {'name': 'Approve Leave Request', 'code': 'leave.approve', 'group': 'Leave Group'},
                {'name': 'Delete Leave Request', 'code': 'leave.delete', 'group': 'Leave Group'},
                # Payroll
                {'name': 'View Payroll', 'code': 'payroll.view', 'group': 'Payroll Group'},
                {'name': 'Manage Payroll', 'code': 'payroll.manage', 'group': 'Payroll Group'},
                # Settings
                {'name': 'View Settings', 'code': 'settings.view', 'group': 'Settings Group'},
                {'name': 'Manage Settings', 'code': 'settings.manage', 'group': 'Settings Group'},
                # RBAC
                {'name': 'View Access Control', 'code': 'rbac.view', 'group': 'RBAC Group'},
                {'name': 'Manage Access Control', 'code': 'rbac.manage', 'group': 'RBAC Group'},
            ]
            permissions = {}
            for p_info in perms_data:
                p, created = Permission.objects.get_or_create(
                    code=p_info['code'],
                    defaults={
                        'name': p_info['name'],
                        'group': groups[p_info['group']],
                        'is_active': True
                    }
                )
                permissions[p_info['code']] = p
                if created:
                    self.stdout.write(f"  Created Permission: {p.code}")

            # 4. Roles
            roles_data = [
                {'name': 'Super Admin', 'desc': 'Full control over the entire system (bypasses all checks)'},
                {'name': 'HR Manager', 'desc': 'Manage recruitment, employees, leaves, payroll, and settings'},
                {'name': 'HR Executive', 'desc': 'Manage candidates, interviews, and view employee records'},
                {'name': 'Employee', 'desc': 'View dashboard, check in/out, apply leave, and track own tasks'},
            ]
            roles = {}
            for r_info in roles_data:
                r, created = Role.objects.get_or_create(
                    name=r_info['name'],
                    defaults={'description': r_info['desc'], 'is_active': True}
                )
                roles[r_info['name']] = r
                if created:
                    self.stdout.write(f"  Created Role: {r.name}")

            # 5. Grant permissions to Roles
            grants = {
                'Super Admin': list(permissions.keys()),  # gets all
                'HR Manager': [
                    code for code in permissions.keys() if code != 'rbac.manage'
                ],
                'HR Executive': [
                    'recruitment.view', 'recruitment.create', 'recruitment.edit',
                    'employee.view', 'attendance.view', 'leave.view', 'settings.view'
                ],
                'Employee': [
                    'employee.view', 'attendance.view', 'attendance.create',
                    'leave.view', 'leave.create', 'settings.view'
                ]
            }

            for role_name, perm_codes in grants.items():
                role = roles[role_name]
                for code in perm_codes:
                    perm = permissions[code]
                    RolePermission.objects.get_or_create(role=role, permission=perm)
                self.stdout.write(f"  Assigned {len(perm_codes)} permissions to Role: {role_name}")

            # 6. Map existing users to Roles if not already mapped
            for u in AppUser.objects.all():
                if not u.role_ref:
                    legacy_role = (u.role or '').lower()
                    if legacy_role == 'admin':
                        u.role_ref = roles['Super Admin']
                    elif legacy_role == 'hr':
                        u.role_ref = roles['HR Manager']
                    elif legacy_role == 'recruitment':
                        u.role_ref = roles['HR Executive']
                    else:
                        u.role_ref = roles['Employee']
                    u.save()
                    self.stdout.write(f"  Mapped user {u.email} to Role: {u.role_ref.name}")

        self.stdout.write(self.style.SUCCESS("Successfully seeded RBAC defaults!"))
