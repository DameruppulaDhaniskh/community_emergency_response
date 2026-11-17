import re
from django.core.exceptions import ValidationError

USERNAME_REGEX = re.compile(r'^[A-Za-z0-9_.]{3,30}$')


def validate_username_format(value: str) -> str:
    cleaned = (value or '').strip()
    if not USERNAME_REGEX.match(cleaned):
        raise ValidationError(
            'Username must be 3-30 characters and contain only letters, digits, dots (.), or underscores (_).'
        )
    return cleaned


def normalize_phone(raw: str) -> str:
    """
    Normalize a phone number to +<country_code><digits>.
    Defaults to +91 for 10-digit inputs (or 11-digit 0-prefixed local numbers).
    Raises ValueError on invalid format.
    """
    text = (raw or '').strip()
    if not text:
        return ''
    if re.search(r'[A-Za-z]', text):
        raise ValueError('Enter a valid phone number (digits only, optional +country code).')

    # Allow only digits, spaces, hyphens, parentheses, dots, and optional leading +
    stripped = re.sub(r'[\s\-().]', '', text)
    has_plus = stripped.startswith('+')
    digits = re.sub(r'\D', '', stripped)

    if has_plus:
        if stripped[1:] != digits:
            raise ValueError('Enter a valid phone number (only one leading + allowed).')
        if not (10 <= len(digits) <= 15) or digits.startswith('0'):
            raise ValueError('Enter a valid international phone number (e.g. +919876543210).')
        return f'+{digits}'

    if stripped != digits:
        raise ValueError('Enter a valid phone number (e.g. 9876543210 or +91 98765 43210).')

    if len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    if len(digits) == 10:
        return f'+91{digits}'
    if len(digits) == 12 and digits.startswith('91'):
        return f'+{digits}'

    raise ValueError('Enter a valid 10-digit phone number or include a country code (e.g. +91 98765 43210).')


def try_normalize_phone(raw: str) -> str | None:
    try:
        res = normalize_phone(raw)
        return res or None
    except ValueError:
        return None


def mask_phone(phone: str) -> str:
    """Return masked phone string such as +91 ******3210."""
    if not phone:
        return ''
    if phone.startswith('+91') and len(phone) >= 7:
        return f'+91 ******{phone[-4:]}'
    digits = re.sub(r'\D', '', phone)
    if len(digits) <= 4:
        return '*' * len(digits)
    if phone.startswith('+') and len(digits) > 8:
        prefix = phone[: len(phone) - 10] if len(digits) >= 11 else '+'
        return f'{prefix} ******{digits[-4:]}'.strip()
    return f'******{digits[-4:]}'

