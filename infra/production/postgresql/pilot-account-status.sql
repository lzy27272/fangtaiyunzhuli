\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

SELECT login_name, display_name, status, (password_hash IS NOT NULL)
FROM user_account
ORDER BY login_name;
