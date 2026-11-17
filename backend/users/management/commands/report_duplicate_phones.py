from collections import defaultdict
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from users.validators import normalize_phone


class Command(BaseCommand):
    help = 'Report duplicate normalized phone numbers or case-insensitive duplicate usernames before applying unique constraints.'

    def handle(self, *args, **options):
        User = get_user_model()
        by_phone = defaultdict(list)
        by_username = defaultdict(list)
        invalid_phones = []

        for u in User.objects.all().order_by('id'):
            by_username[(u.username or '').strip().lower()].append(u)
            if not u.phone:
                continue
            try:
                norm = normalize_phone(u.phone)
                by_phone[norm].append((u, u.phone, norm))
            except ValueError as exc:
                invalid_phones.append((u, u.phone, str(exc)))

        dup_phones = {k: v for k, v in by_phone.items() if len(v) > 1}
        dup_usernames = {k: v for k, v in by_username.items() if len(v) > 1}

        if not dup_phones and not dup_usernames and not invalid_phones:
            self.stdout.write(self.style.SUCCESS('All user phone numbers and usernames are valid and unique.'))
            return

        if invalid_phones:
            self.stdout.write(self.style.WARNING('Invalid phone formats:'))
            for u, raw, err in invalid_phones:
                self.stdout.write(f'  id={u.id} email={u.email} username={u.username} phone={raw!r} -> {err}')

        if dup_phones:
            self.stdout.write(self.style.ERROR('Duplicate normalized phone numbers found:'))
            for norm, items in dup_phones.items():
                self.stdout.write(f'  Normalized phone {norm}:')
                for u, raw, _ in items:
                    self.stdout.write(f'    - id={u.id} username={u.username} email={u.email} raw_phone={raw!r}')

        if dup_usernames:
            self.stdout.write(self.style.ERROR('Case-insensitive duplicate usernames found:'))
            for uname, items in dup_usernames.items():
                self.stdout.write(f'  Username {uname}:')
                for u in items:
                    self.stdout.write(f'    - id={u.id} username={u.username!r} email={u.email}')

