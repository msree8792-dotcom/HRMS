import os
import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hrms_project.settings')

import django
from django.test import TestCase

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
django.setup()

from api.views import create_notification
from api.models import Notification


class NotificationTests(TestCase):
    def test_create_notification_saves_record(self):
        notification = create_notification(
            'employee@example.com',
            'Welcome',
            'Your account is ready.',
            'success',
            '/profile',
        )

        self.assertIsNotNone(notification)
        assert notification is not None
        self.assertTrue(Notification.objects.filter(pk=notification.pk).exists())
        self.assertEqual(notification.recipient, 'employee@example.com')
        self.assertFalse(notification.is_read)
