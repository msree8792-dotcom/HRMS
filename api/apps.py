from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.AutoField'
    name = 'api'

    def ready(self):
        try:
            from .models import Notification
            for n in Notification.objects.all():
                if n.link and n.link.startswith('/') and not n.link.startswith('/employees/') and not n.link.startswith('/recruit/'):
                    if n.link in ('/leave', '/submissions', '/tasks', '/attendance'):
                        n.link = '/employees' + n.link
                        n.save()
                    elif n.link == '/interviews':
                        n.link = '/recruit/interview'
                        n.save()
        except Exception:
            pass
