import time
import logging
from django.core.cache import cache
from django.core.management.base import BaseCommand
from django.utils import timezone
from incidents.escalation import process_due_escalations

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Background worker to process due SafeCircle incident escalations and no-responder alerts.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--interval',
            type=int,
            default=5,
            help='Polling interval in seconds (default: 5)',
        )
        parser.add_argument(
            '--once',
            action='store_true',
            help='Run a single pass and exit immediately',
        )

    def handle(self, *args, **options):
        interval = options['interval']
        run_once = options['once']

        self.stdout.write(self.style.SUCCESS(f'Starting SafeCircle escalation worker (interval={interval}s)...'))

        while True:
            try:
                cache.set('safecircle_escalation_worker_heartbeat', timezone.now().isoformat(), timeout=60)
                process_due_escalations()
            except Exception as e:
                logger.exception('Error during process_due_escalations: %s', e)
                self.stderr.write(self.style.ERROR(f'Error processing escalations: {e}'))

            if run_once:
                self.stdout.write(self.style.SUCCESS('Single pass completed.'))
                break

            time.sleep(interval)

