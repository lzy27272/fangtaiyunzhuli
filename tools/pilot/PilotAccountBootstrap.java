import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public class PilotAccountBootstrap {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final int ITERATIONS = 210_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: <jdbc-url> <credential-output-file>");
        String owner = required("PILOT_DB_OWNER");
        String password = required("PILOT_DB_OWNER_PASSWORD");
        List<String> credentials = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(args[0], owner, password)) {
            connection.setAutoCommit(false);
            try (PreparedStatement context = connection.prepareStatement("select set_config('app.tenant_id', ?, true)")) {
                context.setString(1, TENANT); context.execute();
            }
            try (PreparedStatement select = connection.prepareStatement("""
                    select id, login_name, display_name
                    from user_account
                    where tenant_id = ?::uuid and status = 'ACTIVE' and password_hash is null
                      and lower(login_name) <> 'system'
                    order by login_name
                    for update
                    """)) {
                select.setString(1, TENANT);
                try (ResultSet rows = select.executeQuery()) {
                    while (rows.next()) {
                        String initialPassword = "Sfg!9" + Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(10));
                        try (PreparedStatement update = connection.prepareStatement("""
                                update user_account set password_hash = ?, password_changed_at = now(), updated_at = now()
                                where tenant_id = ?::uuid and id = ?::uuid and password_hash is null
                                """)) {
                            update.setString(1, hash(initialPassword)); update.setString(2, TENANT); update.setString(3, rows.getString("id"));
                            if (update.executeUpdate() == 1) credentials.add(rows.getString("display_name") + "\t" + rows.getString("login_name") + "\t" + initialPassword);
                        }
                    }
                }
            }
            connection.commit();
        }
        Path output = Path.of(args[1]).toAbsolutePath().normalize();
        if (!credentials.isEmpty()) {
            Files.createDirectories(output.getParent());
            String header = "\r\n# Generated " + OffsetDateTime.now() + "\r\n姓名\t登录账号\t初始密码\r\n";
            Files.writeString(output, header + String.join("\r\n", credentials) + "\r\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        }
        System.out.println("Pilot accounts initialized: " + credentials.size());
        System.out.println("Credential file: " + output);
    }

    private static String hash(String password) throws Exception {
        byte[] salt = randomBytes(16);
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        byte[] derived;
        try { derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); }
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return "pbkdf2_sha256$" + ITERATIONS + "$" + encoder.encodeToString(salt) + "$" + encoder.encodeToString(derived);
    }

    private static byte[] randomBytes(int count) { byte[] value = new byte[count]; RANDOM.nextBytes(value); return value; }
    private static String required(String key) { String value = System.getenv(key); if (value == null || value.isBlank()) throw new IllegalStateException(key + " is required"); return value; }
}
