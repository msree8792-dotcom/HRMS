#!/usr/bin/env python
import os
import sys
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hrms_project.settings')
import django
django.setup()

from api.models import Notification

if len(sys.argv) < 2:
    print('Usage: python scripts/list_notifications.py email')
    sys.exit(2)

email = sys.argv[1].strip().lower()
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
print(json.dumps({'email': email, 'count': len(rows), 'notifications': rows}, indent=2))
