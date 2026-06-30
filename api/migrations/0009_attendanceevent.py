# Generated for the Activity Log / Team Status panels (attendance_events table).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_worksubmission_ai_score_worksubmission_type_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='AttendanceEvent',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.CharField(db_index=True, max_length=255)),
                ('employee_name', models.CharField(blank=True, default='', max_length=255)),
                ('date', models.DateField(db_index=True)),
                ('event', models.CharField(max_length=30)),
                ('location', models.CharField(blank=True, default='', max_length=120)),
                ('at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'attendance_events',
                'ordering': ['at', 'id'],
            },
        ),
    ]
