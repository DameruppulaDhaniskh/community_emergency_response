from collections import defaultdict
from django.db import migrations, models
from django.db.models.functions import Lower

from users.validators import normalize_phone


def normalize_and_check_duplicates(apps, schema_editor):
    User = apps.get_model('users', 'User')
    by_phone = defaultdict(list)
    by_username = defaultdict(list)
    updates = []

    for u in User.objects.all().order_by('id'):
        uname_clean = (u.username or '').strip()
        by_username[uname_clean.lower()].append(u)
        if u.phone:
            try:
                norm = normalize_phone(u.phone)
            except ValueError as exc:
                raise RuntimeError(
                    f'Cannot normalize phone for user id={u.id} ({u.email}): {u.phone!r} ({exc}). '
                    'Run `python manage.py report_duplicate_phones` to inspect and fix before migrating.'
                )
            by_phone[norm].append((u, u.phone, norm))
            if u.phone != norm:
                u.phone = norm
                updates.append(u)

    dup_phones = {k: v for k, v in by_phone.items() if len(v) > 1}
    dup_usernames = {k: v for k, v in by_username.items() if len(v) > 1}

    if dup_phones or dup_usernames:
        lines = ['Migration aborted safely without deleting any data:']
        if dup_phones:
            lines.append('Duplicate normalized phone numbers found:')
            for norm, items in dup_phones.items():
                lines.append(f'  {norm}:')
                for u, raw, _ in items:
                    lines.append(f'    - id={u.id} username={u.username} email={u.email} phone={raw!r}')
        if dup_usernames:
            lines.append('Case-insensitive duplicate usernames found:')
            for uname, items in dup_usernames.items():
                lines.append(f'  {uname}:')
                for u in items:
                    lines.append(f'    - id={u.id} username={u.username!r} email={u.email}')
        lines.append('Run `python manage.py report_duplicate_phones`, resolve duplicates, and re-run `python manage.py migrate`.')
        raise RuntimeError('\n'.join(lines))

    for u in updates:
        u.save(update_fields=['phone'])


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_alter_user_id'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='phone',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.RunPython(normalize_and_check_duplicates, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(
                Lower('username'),
                name='unique_user_username_ci',
            ),
        ),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(
                fields=('phone',),
                condition=~models.Q(('phone', '')),
                name='unique_user_phone',
            ),
        ),
    ]

