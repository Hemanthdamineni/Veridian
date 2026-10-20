"""
Notification Service

Sends notifications via multiple channels:
- Email (SMTP or API like Resend)
- Telegram (Bot API)
- Discord (Incoming Webhooks)
- Web Push (Push API)

Based on Veridian-spec.md B.7
"""

from veridian_db.clock import utcnow

import logging
import json
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any


class NotificationChannel(Enum):
    EMAIL = "email"
    TELEGRAM = "telegram"
    DISCORD = "discord"
    PUSH = "push"


@dataclass
class NotificationMessage:
    """A notification to be sent."""
    channel: NotificationChannel
    recipient: str  # email, chat_id, webhook URL, etc.
    subject: str
    body: str
    metadata: Dict[str, Any] = None
    created_at: datetime = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
        if self.created_at is None:
            self.created_at = utcnow()


class NotificationService:
    """
    Multi-channel notification service.

    Supports:
    - Email via SMTP or Resend API
    - Telegram via Bot API
    - Discord via Incoming Webhooks
    - Web Push via Push API
    """

    def __init__(self, config: Dict[str, str] = None):
        self.logger = logging.getLogger(__name__)
        self.config = config or {}
        self._sent_count: Dict[NotificationChannel, int] = {
            channel: 0 for channel in NotificationChannel
        }

    def send(self, message: NotificationMessage) -> bool:
        """
        Send a notification via the specified channel.

        Args:
            message: The notification to send

        Returns:
            True if sent successfully
        """
        handlers = {
            NotificationChannel.EMAIL: self._send_email,
            NotificationChannel.TELEGRAM: self._send_telegram,
            NotificationChannel.DISCORD: self._send_discord,
            NotificationChannel.PUSH: self._send_push,
        }

        handler = handlers.get(message.channel)
        if not handler:
            self.logger.error(f"Unknown channel: {message.channel}")
            return False

        try:
            success = handler(message)
            if success:
                self._sent_count[message.channel] += 1
            return success
        except Exception as e:
            self.logger.error(f"Failed to send {message.channel.value} notification: {e}")
            return False

    def _send_email(self, message: NotificationMessage) -> bool:
        """Send email notification."""
        # Try Resend API first, fall back to SMTP
        api_key = self.config.get("RESEND_API_KEY")
        if api_key:
            return self._send_email_resend(message, api_key)

        smtp_host = self.config.get("SMTP_HOST")
        if smtp_host:
            return self._send_email_smtp(message)

        self.logger.warning("No email configuration found")
        return False

    def _send_email_resend(self, message: NotificationMessage, api_key: str) -> bool:
        """Send email via Resend API."""
        import httpx

        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": self.config.get("EMAIL_FROM", "alerts@veridian.app"),
                    "to": message.recipient,
                    "subject": message.subject,
                    "text": message.body,
                },
                timeout=30,
            )
            return response.status_code == 200
        except Exception as e:
            self.logger.error(f"Resend API error: {e}")
            return False

    def _send_email_smtp(self, message: NotificationMessage) -> bool:
        """Send email via SMTP."""
        import smtplib
        from email.mime.text import MIMEText

        try:
            msg = MIMEText(message.body)
            msg["Subject"] = message.subject
            msg["From"] = self.config.get("EMAIL_FROM", "alerts@veridian.app")
            msg["To"] = message.recipient

            with smtplib.SMTP(
                self.config.get("SMTP_HOST", "localhost"),
                int(self.config.get("SMTP_PORT", 587)),
            ) as server:
                if self.config.get("SMTP_TLS", "true").lower() == "true":
                    server.starttls()
                if self.config.get("SMTP_USER"):
                    server.login(
                        self.config["SMTP_USER"],
                        self.config.get("SMTP_PASSWORD", ""),
                    )
                server.send_message(msg)

            return True
        except Exception as e:
            self.logger.error(f"SMTP error: {e}")
            return False

    def _send_telegram(self, message: NotificationMessage) -> bool:
        """Send Telegram message via Bot API."""
        import httpx

        bot_token = self.config.get("TELEGRAM_BOT_TOKEN")
        if not bot_token:
            self.logger.warning("No Telegram bot token configured")
            return False

        try:
            response = httpx.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": message.recipient,
                    "text": f"*{message.subject}*\n\n{message.body}",
                    "parse_mode": "Markdown",
                },
                timeout=30,
            )
            return response.status_code == 200
        except Exception as e:
            self.logger.error(f"Telegram API error: {e}")
            return False

    def _send_discord(self, message: NotificationMessage) -> bool:
        """Send Discord message via Incoming Webhook."""
        import httpx

        webhook_url = message.recipient
        if not webhook_url.startswith("https://discord.com/api/webhooks/"):
            self.logger.error("Invalid Discord webhook URL")
            return False

        try:
            response = httpx.post(
                webhook_url,
                json={
                    "embeds": [{
                        "title": message.subject,
                        "description": message.body,
                        "color": 3447003,  # Blue
                        "timestamp": message.created_at.isoformat() if message.created_at else None,
                    }]
                },
                timeout=30,
            )
            return response.status_code == 204
        except Exception as e:
            self.logger.error(f"Discord webhook error: {e}")
            return False

    def _send_push(self, message: NotificationMessage) -> bool:
        """
        Send Web Push notification.

        Note: Web Push requires the pywebpush library and VAPID keys.
        """
        try:
            from pywebpush import webpush, WebPushException

            subscription_info = message.metadata.get("subscription")
            if not subscription_info:
                self.logger.error("No push subscription info provided")
                return False

            vapid_private_key = self.config.get("VAPID_PRIVATE_KEY")
            vapid_claims = self.config.get("VAPID_CLAIMS", {})

            if not vapid_private_key:
                self.logger.warning("No VAPID private key configured")
                return False

            webpush(
                subscription_info=subscription_info,
                data=json.dumps({
                    "title": message.subject,
                    "body": message.body,
                }),
                vapid_private_key=vapid_private_key,
                vapid_claims=vapid_claims,
            )
            return True
        except ImportError:
            self.logger.error("pywebpush not installed. Run: pip install pywebpush")
            return False
        except WebPushException as e:
            self.logger.error(f"Web Push error: {e}")
            return False

    def get_statistics(self) -> Dict[str, int]:
        """Get notification statistics."""
        return {
            channel.value: count
            for channel, count in self._sent_count.items()
        }
