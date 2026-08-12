package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.contracts.port.IdentityProviderPort;

import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Resolves only server-trusted platform identity data; client-supplied roles are never accepted. */
public final class PlatformIdentityAuthorizationService {
    private final IdentityProviderPort identities;
    private final PlatformRoleMapper roles;

    public PlatformIdentityAuthorizationService(
            IdentityProviderPort identities,
            PlatformRoleMapper roles
    ) {
        this.identities = Objects.requireNonNull(identities, "identities");
        this.roles = Objects.requireNonNull(roles, "roles");
    }

    public Optional<ResolvedPlatformIdentity> resolve(IdentityProviderPort.ExternalIdentity externalIdentity) {
        Objects.requireNonNull(externalIdentity, "externalIdentity");
        return identities.resolve(externalIdentity)
                .filter(IdentityProviderPort.IdentityAccount::enabled)
                .map(account -> {
                    PlatformRoleMapper.MappingResult mapping = roles.map(account.roles());
                    if (mapping.roles().isEmpty()) {
                        return null;
                    }
                    return new ResolvedPlatformIdentity(
                            account.accountId(),
                            account.authorizationVersion(),
                            mapping.roles(),
                            mapping.ignoredRoleCount(),
                            mapping.legacyRevenueRoleObserved());
                });
    }

    public record ResolvedPlatformIdentity(
            UUID accountId,
            long authorizationVersion,
            Set<OtaRole> roles,
            int ignoredRoleCount,
            boolean legacyRevenueRoleObserved
    ) {
        public ResolvedPlatformIdentity {
            Objects.requireNonNull(accountId, "accountId");
            if (authorizationVersion < 1) {
                throw new IllegalArgumentException("authorizationVersion must be positive");
            }
            roles = Set.copyOf(Objects.requireNonNull(roles, "roles"));
            if (ignoredRoleCount < 0) {
                throw new IllegalArgumentException("ignoredRoleCount must not be negative");
            }
        }

        public TrustedAuthorizationContext authorization() {
            return TrustedAuthorizationContext.fromMappedPlatformIdentity(accountId, roles);
        }

        @Override
        public String toString() {
            return "ResolvedPlatformIdentity[accountId=<redacted>, authorizationVersion="
                    + authorizationVersion + ", roles=" + roles
                    + ", ignoredRoleCount=" + ignoredRoleCount
                    + ", legacyRevenueRoleObserved=" + legacyRevenueRoleObserved + "]";
        }
    }
}
