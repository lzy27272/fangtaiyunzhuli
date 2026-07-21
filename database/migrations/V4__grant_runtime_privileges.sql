DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT USAGE ON SCHEMA public TO hotel_ai_os_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hotel_ai_os_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hotel_ai_os_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hotel_ai_os_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO hotel_ai_os_app;
    END IF;
END $$;

