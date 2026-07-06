"""
Django settings for the HRMS project.

Single deployment: Django exposes the REST API under /api/* and also serves
the built React app (Vite `dist/`) for every other route via WhiteNoise.
"""
from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from a dotenv file next to manage.py.
# APP_ENV (default "development") picks the environment-specific file
# (.env.development / .env.production); a plain .env is still honoured as a
# fallback. load_dotenv keeps override=False, so real process env vars and
# the first file loaded win — i.e. .env.<APP_ENV> takes priority over .env.
APP_ENV = os.environ.get('APP_ENV') or os.environ.get('DJANGO_ENV') or 'development'
for _env_file in (f'.env.{APP_ENV}', '.env'):
    _env_path = BASE_DIR / _env_file
    if _env_path.exists():
        load_dotenv(_env_path)


def env_bool(name, default=False):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name, default=''):
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(',') if item.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-insecure-change-me')
DEBUG = env_bool('DJANGO_DEBUG', True)
ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1') or ['*']

# The frontend and API share an origin in production, so CSRF is not an
# issue for the API (views are csrf-exempt). Trust the configured hosts for
# any form posts that might be added later.
CSRF_TRUSTED_ORIGINS = [
    f'https://{h}' for h in ALLOWED_HOSTS if h not in ('localhost', '127.0.0.1', '*')
]

# Keep the project minimal: no admin/auth/sessions tables are created in the
# user's MySQL database — only the 8 application tables.
INSTALLED_APPS = [
    'corsheaders',
    # 'django.contrib.auth'
    
    'django.contrib.staticfiles',
    
    
    'rest_framework',
    'api',
]

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
# This project deliberately omits django.contrib.auth/sessions/contenttypes
# (no auth tables are created in the user's MySQL DB — the app handles its own
# login via the app_users table). So DRF must NOT use any auth/permission
# classes that reference the User model, and request.user must resolve to None
# instead of AnonymousUser (which would import django.contrib.auth).
#
# JSON-only in/out keeps the wire format identical to the original Node/Express
# API the React frontend talks to.
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'UNAUTHENTICATED_USER': None,
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'hrms_project.urls'
WSGI_APPLICATION = 'hrms_project.wsgi.application'
ASGI_APPLICATION = 'hrms_project.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': []},
    },
]

# ---------------------------------------------------------------------------
# Database — MySQL (same DB the Node backend used)
# ---------------------------------------------------------------------------
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.environ.get('DB_NAME', 'hrms-ai'),
        'USER': os.environ.get('DB_USER', 'hrms-ais'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
        },
    }
}

# Match the existing INT AUTO_INCREMENT primary keys (not BIGINT).
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

# ---------------------------------------------------------------------------
# Large payloads: base64 video (recordingData) and document uploads can be big.
# Mirror the Node server's generous body limits.
# ---------------------------------------------------------------------------
DATA_UPLOAD_MAX_MEMORY_SIZE = None          # disable the size guard
FILE_UPLOAD_MAX_MEMORY_SIZE = 500 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = None
APPEND_SLASH = False                         # API paths have no trailing slash

# ---------------------------------------------------------------------------
# Static files + React build
# ---------------------------------------------------------------------------
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Built React app (Vite output). Default: ../dist relative to this project.
REACT_BUILD_DIR = Path(
    os.environ.get('REACT_BUILD_DIR', BASE_DIR.parent / 'dist')
).resolve()

# WhiteNoise serves the dist/ folder at the site root so that the absolute
# asset paths Vite emits (e.g. /assets/index-xxx.js, /favicon.svg) resolve.
WHITENOISE_ROOT = str(REACT_BUILD_DIR)
WHITENOISE_INDEX_FILE = True

STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

# ---------------------------------------------------------------------------
# CORS — only needed when running the React dev server (localhost:3000)
# against this API on a different port. Same-origin in production.
# ---------------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = DEBUG
from corsheaders.defaults import default_headers  # noqa: E402
CORS_ALLOW_HEADERS = list(default_headers) + ['x-api-key', 'x-user-email', 'x-actor-email']

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = False  # the Node app stored naive datetimes (dateStrings)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}
