# Live presence (STATUS picker) on the daily attendance row — drives the
# presence labels shown in the Team Status Now panel.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_attendanceevent'),
    ]

    operations = [
        migrations.AddField(
            model_name='employeeattendance',
            name='presence',
            field=models.CharField(blank=True, default='', max_length=40),
        ),
        migrations.AddField(
            model_name='employeeattendance',
            name='presence_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
