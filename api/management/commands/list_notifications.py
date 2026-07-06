from django.core.management.base import BaseCommand
from api.models import Notification
import json

class Command(BaseCommand):
    help = 'List notifications for an email'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True, help='Email to query')

    def handle(self, *args, **options):
        email = (options['email'] or '').strip().lower()
        qs = Notification.objects.filter(recipient=email).order_by('-created_at')
        rows = []
        for n in qs:
            rows.append({
                'id': n.id,
                'recipient': n.recipient,
                'title': n.title,
                'message': n.message,
                'notification_type': n.notification_type,
                'is_read': n.is_read,
                'link': n.link,
                'created_at': n.created_at.isoformat() if n.created_at else None,
            })
        out = {'email': email, 'count': len(rows), 'notifications': rows}
        self.stdout.write(json.dumps(out, indent=2))
