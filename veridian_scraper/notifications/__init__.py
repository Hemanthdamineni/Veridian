"""
Notification Service for Veridian.

Sends notifications via email, Telegram, Discord, and web push.
"""

from .notifier import NotificationService, NotificationMessage

__all__ = [
    "NotificationService",
    "NotificationMessage",
]
