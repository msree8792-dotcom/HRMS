from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_google_auth_interview_tokens'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='department',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='designation',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
    ]
