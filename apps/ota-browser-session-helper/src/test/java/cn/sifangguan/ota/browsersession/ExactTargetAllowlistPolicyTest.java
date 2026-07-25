package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExactTargetAllowlistPolicyTest {
    private static final BrowserRequestContract POST_CONTRACT =
            new BrowserRequestContract(
                    "approved-report",
                    "v1",
                    "a".repeat(64));
    private static final BrowserTarget ALLOWED_TARGET = BrowserTarget.httpsPost(
            "pms.example.test",
            "/approved/read-only/report",
            POST_CONTRACT);
    private static final ResolvedNetworkAddress PUBLIC_ADDRESS =
            new ResolvedNetworkAddress("93.184.216.34");

    private final BrowserSessionBinding binding = binding(
            "tenant-1",
            "hotel-1",
            "connector-1",
            "1.0.0",
            "config-7",
            "actor-1",
            UUID.fromString("82ad8bd7-96bb-4c68-848c-edfa2ef4eb93"));
    private final ExactTargetAllowlistPolicy policy =
            new ExactTargetAllowlistPolicy(Set.of(ALLOWED_TARGET));

    @Test
    void allowsOnlyExactHttpsHostPortMethodPathAndRequestContract() {
        var active = snapshot(BrowserSessionState.ACTIVE, binding);

        assertTrue(policy.authorize(
                active,
                request(binding, ALLOWED_TARGET, Set.of(PUBLIC_ADDRESS), 0)).allowed());
        assertDeniedTarget(BrowserTarget.httpsGet(
                "pms.example.test",
                "/approved/read-only/report"));
        assertDeniedTarget(BrowserTarget.httpsPost(
                "pms.example.test",
                8443,
                "/approved/read-only/report",
                POST_CONTRACT));
        assertDeniedTarget(BrowserTarget.httpsPost(
                "pms.example.test",
                "/approved/read-only/other",
                POST_CONTRACT));
        assertDeniedTarget(BrowserTarget.httpsPost(
                "other.example.test",
                "/approved/read-only/report",
                POST_CONTRACT));
        assertDeniedTarget(BrowserTarget.httpsPost(
                "pms.example.test",
                "/approved/read-only/report",
                new BrowserRequestContract(
                        "approved-report",
                        "v1",
                        "b".repeat(64))));
    }

    @Test
    void refusesEveryCrossScopeSessionReuseDimension() {
        var active = snapshot(BrowserSessionState.ACTIVE, binding);
        var mismatches = List.of(
                binding(
                        "tenant-2", binding.hotelId(), binding.connectorId(),
                        binding.connectorVersion(), binding.configVersion(),
                        binding.actorId(), binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), "hotel-2", binding.connectorId(),
                        binding.connectorVersion(), binding.configVersion(),
                        binding.actorId(), binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), binding.hotelId(), "connector-2",
                        binding.connectorVersion(), binding.configVersion(),
                        binding.actorId(), binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), binding.hotelId(), binding.connectorId(),
                        "2.0.0", binding.configVersion(),
                        binding.actorId(), binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), binding.hotelId(), binding.connectorId(),
                        binding.connectorVersion(), "config-8",
                        binding.actorId(), binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), binding.hotelId(), binding.connectorId(),
                        binding.connectorVersion(), binding.configVersion(),
                        "actor-2", binding.authorizationAttemptId()),
                binding(
                        binding.tenantId(), binding.hotelId(), binding.connectorId(),
                        binding.connectorVersion(), binding.configVersion(),
                        binding.actorId(), UUID.randomUUID()));

        for (var mismatch : mismatches) {
            var decision = policy.authorize(
                    active,
                    request(mismatch, ALLOWED_TARGET, Set.of(PUBLIC_ADDRESS), 0));
            assertFalse(decision.allowed());
            assertEquals(
                    BrowserSessionErrorCode.SESSION_SCOPE_MISMATCH,
                    decision.denialCode().orElseThrow());
        }
    }

    @Test
    void failsClosedForEveryNonActiveSessionState() {
        assertDeniedState(
                BrowserSessionState.PENDING_INTERACTIVE_LOGIN,
                BrowserSessionErrorCode.INTERACTIVE_LOGIN_REQUIRED);
        assertDeniedState(
                BrowserSessionState.EXPIRING,
                BrowserSessionErrorCode.SESSION_EXPIRING);
        assertDeniedState(
                BrowserSessionState.REAUTH_REQUIRED,
                BrowserSessionErrorCode.REAUTH_REQUIRED);
        assertDeniedState(
                BrowserSessionState.REVOKED,
                BrowserSessionErrorCode.SESSION_REVOKED);
    }

    @Test
    void requiresResolvedAddressesAndRefusesEveryNonPublicAnswer() {
        var active = snapshot(BrowserSessionState.ACTIVE, binding);
        var missing = policy.authorize(
                active,
                request(binding, ALLOWED_TARGET, Set.of(), 0));
        assertEquals(
                BrowserSessionErrorCode.RESOLVED_ADDRESS_REQUIRED,
                missing.denialCode().orElseThrow());

        for (var literal : List.of(
                "127.0.0.1",
                "10.0.0.7",
                "172.16.0.7",
                "192.168.0.7",
                "169.254.169.254",
                "100.100.100.200",
                "::1",
                "fe80::1",
                "fd00:ec2::254")) {
            var denied = policy.authorize(
                    active,
                    request(
                            binding,
                            ALLOWED_TARGET,
                            Set.of(new ResolvedNetworkAddress(literal)),
                            0));
            assertEquals(
                    BrowserSessionErrorCode.NON_PUBLIC_ADDRESS_FORBIDDEN,
                    denied.denialCode().orElseThrow());
        }
    }

    @Test
    void eachRedirectHopMustBeReauthorizedAgainstTargetAndAddressPolicies() {
        var approvedRedirect = BrowserTarget.httpsGet(
                "reports.example.test",
                "/final/report");
        var redirectPolicy = new ExactTargetAllowlistPolicy(
                Set.of(ALLOWED_TARGET, approvedRedirect));
        var active = snapshot(BrowserSessionState.ACTIVE, binding);

        assertTrue(redirectPolicy.authorize(
                active,
                request(binding, ALLOWED_TARGET, Set.of(PUBLIC_ADDRESS), 0)).allowed());
        assertTrue(redirectPolicy.authorize(
                active,
                request(
                        binding,
                        approvedRedirect,
                        Set.of(new ResolvedNetworkAddress("1.1.1.1")),
                        1)).allowed());

        var unlistedRedirect = redirectPolicy.authorize(
                active,
                request(
                        binding,
                        BrowserTarget.httpsGet(
                                "unlisted.example.test",
                                "/final/report"),
                        Set.of(new ResolvedNetworkAddress("1.1.1.1")),
                        1));
        var privateRedirect = redirectPolicy.authorize(
                active,
                request(
                        binding,
                        approvedRedirect,
                        Set.of(new ResolvedNetworkAddress("127.0.0.1")),
                        1));

        assertEquals(
                BrowserSessionErrorCode.TARGET_NOT_ALLOWLISTED,
                unlistedRedirect.denialCode().orElseThrow());
        assertEquals(
                BrowserSessionErrorCode.NON_PUBLIC_ADDRESS_FORBIDDEN,
                privateRedirect.denialCode().orElseThrow());
    }

    @Test
    void rejectsNonHttpsInvalidPortsForbiddenHostsAndAmbiguousPaths() {
        assertInvalidTarget(() -> new BrowserTarget(
                "http",
                "pms.example.test",
                443,
                BrowserRequestMethod.GET,
                "/report",
                Optional.empty()));
        assertInvalidTarget(() -> BrowserTarget.httpsGet(
                "pms.example.test",
                0,
                "/report"));
        assertInvalidTarget(() -> BrowserTarget.httpsGet(
                "pms.example.test",
                65536,
                "/report"));
        for (var invalidHost : Set.of(
                "*.example.test",
                "https://pms.example.test",
                "pms.example.test:443",
                "PMS.example.test",
                "pms..example.test",
                "localhost",
                "metadata.google.internal",
                "169.254.169.254",
                "10.0.0.7")) {
            assertInvalidTarget(() -> BrowserTarget.httpsGet(
                    invalidHost,
                    "/report"));
        }
        for (var invalidPath : Set.of(
                "report",
                "/report?date=today",
                "/report#section",
                "/report/../admin",
                "/report//detail",
                "/report\\detail")) {
            assertInvalidTarget(() -> BrowserTarget.httpsGet(
                    "pms.example.test",
                    invalidPath));
        }
    }

    @Test
    void postRequiresFixedCanonicalContractAndGetForbidsOne() {
        var missingPostContract = assertThrows(
                BrowserSessionPolicyException.class,
                () -> new BrowserTarget(
                        "https",
                        "pms.example.test",
                        443,
                        BrowserRequestMethod.POST,
                        "/report",
                        Optional.empty()));
        var unexpectedGetContract = assertThrows(
                BrowserSessionPolicyException.class,
                () -> new BrowserTarget(
                        "https",
                        "pms.example.test",
                        443,
                        BrowserRequestMethod.GET,
                        "/report",
                        Optional.of(POST_CONTRACT)));
        var invalidDigest = assertThrows(
                BrowserSessionPolicyException.class,
                () -> new BrowserRequestContract(
                        "report",
                        "v1",
                        "not-a-sha-256"));

        assertEquals(
                BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT,
                missingPostContract.errorCode());
        assertEquals(
                BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT,
                unexpectedGetContract.errorCode());
        assertEquals(
                BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT,
                invalidDigest.errorCode());
    }

    private void assertDeniedTarget(BrowserTarget target) {
        var decision = policy.authorize(
                snapshot(BrowserSessionState.ACTIVE, binding),
                request(binding, target, Set.of(PUBLIC_ADDRESS), 0));
        assertFalse(decision.allowed());
        assertEquals(
                BrowserSessionErrorCode.TARGET_NOT_ALLOWLISTED,
                decision.denialCode().orElseThrow());
    }

    private void assertDeniedState(
            BrowserSessionState state,
            BrowserSessionErrorCode expectedCode) {
        var decision = policy.authorize(
                snapshot(state, binding),
                request(binding, ALLOWED_TARGET, Set.of(PUBLIC_ADDRESS), 0));
        assertFalse(decision.allowed());
        assertEquals(expectedCode, decision.denialCode().orElseThrow());
    }

    private void assertInvalidTarget(Runnable constructor) {
        var exception = assertThrows(
                BrowserSessionPolicyException.class,
                constructor::run);
        assertEquals(
                BrowserSessionErrorCode.INVALID_TARGET,
                exception.errorCode());
    }

    private BrowserHopAuthorizationRequest request(
            BrowserSessionBinding requestBinding,
            BrowserTarget target,
            Set<ResolvedNetworkAddress> addresses,
            int hopIndex) {
        return new BrowserHopAuthorizationRequest(
                requestBinding,
                target,
                addresses,
                hopIndex);
    }

    private BrowserSessionSnapshot snapshot(
            BrowserSessionState state,
            BrowserSessionBinding snapshotBinding) {
        return new BrowserSessionSnapshot(
                snapshotBinding,
                state,
                Instant.parse("2026-07-25T04:00:00Z"),
                0);
    }

    private static BrowserSessionBinding binding(
            String tenantId,
            String hotelId,
            String connectorId,
            String connectorVersion,
            String configVersion,
            String actorId,
            UUID attemptId) {
        return new BrowserSessionBinding(
                tenantId,
                hotelId,
                connectorId,
                connectorVersion,
                configVersion,
                actorId,
                attemptId);
    }
}
