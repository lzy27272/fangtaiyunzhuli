CREATE ROLE hotel_ai_os_app
    LOGIN
    PASSWORD 'local-app-only'
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

GRANT CONNECT ON DATABASE hotel_ai_os TO hotel_ai_os_app;
GRANT USAGE ON SCHEMA public TO hotel_ai_os_app;

