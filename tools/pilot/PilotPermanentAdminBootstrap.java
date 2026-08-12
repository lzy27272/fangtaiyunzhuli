import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Base64;
import java.util.UUID;

/**
 * Authorized local-Pilot bootstrap for the protected sfglzy platform administrator.
 * The requested initial password is read only from the process environment and is never printed.
 * This helper is deliberately outside Flyway so the weak local debugging credential cannot reach production.
 */
public final class PilotPermanentAdminBootstrap {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String LOGIN = "sfglzy";
    private static final int ITERATIONS = 210_000;

    private PilotPermanentAdminBootstrap() { }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: <jdbc-url>");
        String resetPassword = required("PILOT_ADMIN_RESET_PASSWORD");
        if (resetPassword.length() < 6 || resetPassword.length() > 128) {
            throw new IllegalArgumentException("Bootstrap password must contain 6 to 128 characters");
        }
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setAutoCommit(false);
            try {
                applyTenantContext(connection);
                UUID accountId = requireAccount(connection);
                UUID roleId = upsertPlatformAdministratorRole(connection);
                grantAllCurrentPermissions(connection, roleId);
                ensurePermanentTenantGrant(connection, accountId, roleId);
                resetPasswordAndUnlock(connection, accountId, resetPassword);
                installProtectionTriggers(connection);
                writeAudit(connection, accountId);
                connection.commit();
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
        System.out.println("Protected local Pilot platform administrator configured without credential output.");
    }

    private static void applyTenantContext(Connection connection) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
                "select set_config('app.tenant_id', ?, true)")) {
            statement.setString(1, TENANT);
            statement.execute();
        }
    }

    private static UUID requireAccount(Connection connection) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select id from user_account
                where tenant_id = ?::uuid and lower(login_name) = lower(?)
                for update
                """)) {
            statement.setString(1, TENANT);
            statement.setString(2, LOGIN);
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) throw new IllegalStateException("Pilot administrator account not found");
                return rows.getObject(1, UUID.class);
            }
        }
    }

    private static UUID upsertPlatformAdministratorRole(Connection connection) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into app_role (tenant_id, code, name, role_type)
                values (?::uuid, 'PLATFORM_ADMIN', '平台永久管理员', 'SYSTEM')
                on conflict (tenant_id, code) do update
                set name = excluded.name, role_type = excluded.role_type, updated_at = now()
                returning id
                """)) {
            statement.setString(1, TENANT);
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) throw new IllegalStateException("Unable to create platform administrator role");
                return rows.getObject(1, UUID.class);
            }
        }
    }

    private static void grantAllCurrentPermissions(Connection connection, UUID roleId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into role_permission (tenant_id, role_id, permission_id)
                select ?::uuid, ?::uuid, permission.id from permission
                on conflict do nothing
                """)) {
            statement.setString(1, TENANT);
            statement.setObject(2, roleId);
            statement.executeUpdate();
        }
    }

    private static void ensurePermanentTenantGrant(Connection connection, UUID accountId, UUID roleId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into role_assignment
                    (tenant_id, account_id, role_id, scope_org_unit_id, scope_type,
                     valid_from, valid_to, granted_by)
                select ?::uuid, ?::uuid, ?::uuid, null, 'TENANT', now(), null, ?::uuid
                where not exists (
                    select 1 from role_assignment
                    where tenant_id = ?::uuid and account_id = ?::uuid
                      and role_id = ?::uuid and valid_to is null
                )
                """)) {
            statement.setString(1, TENANT);
            statement.setObject(2, accountId);
            statement.setObject(3, roleId);
            statement.setObject(4, accountId);
            statement.setString(5, TENANT);
            statement.setObject(6, accountId);
            statement.setObject(7, roleId);
            statement.executeUpdate();
        }
    }

    private static void resetPasswordAndUnlock(
            Connection connection, UUID accountId, String resetPassword) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                update user_account
                set password_hash = ?, password_changed_at = now(), failed_login_attempts = 0,
                    locked_until = null, status = 'ACTIVE', updated_at = now()
                where tenant_id = ?::uuid and id = ?::uuid
                """)) {
            statement.setString(1, hash(resetPassword));
            statement.setString(2, TENANT);
            statement.setObject(3, accountId);
            if (statement.executeUpdate() != 1) throw new IllegalStateException("Pilot administrator update failed");
        }
    }

    private static void installProtectionTriggers(Connection connection) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.execute("""
                    create or replace function protect_pilot_platform_admin_account()
                    returns trigger language plpgsql as $$
                    begin
                        if lower(old.login_name) = 'sfglzy'
                           and old.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid then
                            if TG_OP = 'DELETE' then
                                raise exception 'Protected local Pilot platform administrator cannot be deleted';
                            end if;
                            if new.tenant_id <> old.tenant_id
                               or lower(new.login_name) <> 'sfglzy'
                               or new.status <> 'ACTIVE' then
                                raise exception 'Protected local Pilot platform administrator must remain active';
                            end if;
                        end if;
                        if TG_OP = 'DELETE' then return old; end if;
                        return new;
                    end $$
                    """);
            statement.execute("drop trigger if exists trg_protect_pilot_platform_admin_account on user_account");
            statement.execute("""
                    create trigger trg_protect_pilot_platform_admin_account
                    before update or delete on user_account
                    for each row execute function protect_pilot_platform_admin_account()
                    """);
            statement.execute("""
                    create or replace function protect_pilot_platform_admin_grant()
                    returns trigger language plpgsql as $$
                    declare v_protected boolean;
                    begin
                        select exists (
                            select 1 from user_account account
                            join app_role role on role.tenant_id = account.tenant_id
                            where account.tenant_id = old.tenant_id
                              and account.id = old.account_id
                              and lower(account.login_name) = 'sfglzy'
                              and role.id = old.role_id
                              and role.code = 'PLATFORM_ADMIN'
                        ) into v_protected;
                        if v_protected then
                            if TG_OP = 'DELETE' then
                                raise exception 'Protected local Pilot platform administrator grant cannot be deleted';
                            end if;
                            if new.account_id <> old.account_id
                               or new.role_id <> old.role_id
                               or new.scope_type <> 'TENANT'
                               or new.scope_org_unit_id is not null
                               or new.valid_to is not null then
                                raise exception 'Protected local Pilot platform administrator grant must remain permanent and tenant-wide';
                            end if;
                        end if;
                        if TG_OP = 'DELETE' then return old; end if;
                        return new;
                    end $$
                    """);
            statement.execute("drop trigger if exists trg_protect_pilot_platform_admin_grant on role_assignment");
            statement.execute("""
                    create trigger trg_protect_pilot_platform_admin_grant
                    before update or delete on role_assignment
                    for each row execute function protect_pilot_platform_admin_grant()
                    """);
        }
    }

    private static void writeAudit(Connection connection, UUID accountId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into audit_log
                    (tenant_id, actor_id, action, resource_type, resource_id,
                     correlation_id, trace_id, outcome, sensitivity_level, after_data)
                values (?::uuid, ?::uuid, 'PILOT_PERMANENT_ADMIN_CONFIGURED', 'USER_ACCOUNT', ?::uuid,
                        gen_random_uuid(), gen_random_uuid(), 'SUCCESS', 'RESTRICTED',
                        '{"platformAdmin":true,"permanent":true,"passwordReset":true,"scope":"LOCAL_PILOT"}'::jsonb)
                """)) {
            statement.setString(1, TENANT);
            statement.setObject(2, accountId);
            statement.setObject(3, accountId);
            statement.executeUpdate();
        }
    }

    private static String hash(String password) throws Exception {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        byte[] derived;
        try { derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); }
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return "pbkdf2_sha256$" + ITERATIONS + "$" + encoder.encodeToString(salt) + "$" + encoder.encodeToString(derived);
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
        return value;
    }
}
