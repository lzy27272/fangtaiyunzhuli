package cn.sifangguan.ota.api.sprint1.domain;

import cn.sifangguan.ota.api.authorization.OtaPermission;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public final class Sprint1Mutations {
    private static final Pattern CODE = Pattern.compile("[A-Z0-9][A-Z0-9_-]{1,63}");
    private static final Pattern DISPLAY = Pattern.compile("[^\\p{Cntrl}]{1,160}");
    private static final Pattern TIMEZONE = Pattern.compile("[A-Za-z_]+(?:/[A-Za-z_+-]+)+");
    private static final Pattern SECRET_REFERENCE =
            Pattern.compile("(?:kms|vault|secretstore|oskeyring|envref)://[A-Za-z0-9._:/@+-]{3,500}");

    private Sprint1Mutations() {
    }

    public sealed interface Mutation permits
            UpsertTenant, UpsertHotel, UpsertConnector, UpsertInventoryPool,
            UpsertSellableProduct, UpsertProductMapping, UpsertRevenueTarget,
            UpsertPaceCurve, TriggerSimulation, InitializeSimulationHotel {
        String kind();

        OtaPermission requiredPermission();

        String resourceType();

        UUID resourceId();

        UUID hotelId();

        String canonicalForm();
    }

    public record UpsertTenant(
            UUID tenantId,
            String tenantCode,
            String displayName,
            String timezone,
            String status
    ) implements Mutation {
        public UpsertTenant {
            Objects.requireNonNull(tenantId, "tenantId");
            tenantCode = requireCode(tenantCode, "tenantCode");
            displayName = requireDisplay(displayName, "displayName");
            timezone = requireTimezone(timezone);
            status = requireOneOf(status, "status", "DRAFT", "ACTIVE", "SUSPENDED");
        }

        @Override public String kind() { return "UPSERT_TENANT"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.TENANT_CONFIG_MANAGE; }
        @Override public String resourceType() { return "TENANT_CONFIG"; }
        @Override public UUID resourceId() { return tenantId; }
        @Override public UUID hotelId() { return null; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), tenantId.toString(), tenantCode, displayName, timezone, status);
        }
    }

    public record UpsertHotel(
            UUID hotelId,
            String hotelCode,
            String displayName,
            String timezone,
            String lifecycleStatus,
            boolean collectionEnabled,
            boolean messageEnabled
    ) implements Mutation {
        public UpsertHotel {
            Objects.requireNonNull(hotelId, "hotelId");
            hotelCode = requireCode(hotelCode, "hotelCode");
            displayName = requireDisplay(displayName, "displayName");
            timezone = requireTimezone(timezone);
            lifecycleStatus = requireOneOf(
                    lifecycleStatus, "lifecycleStatus",
                    "DRAFT", "READY_FOR_TEST", "SHADOW", "UAT", "LIVE", "PAUSED");
            if (messageEnabled) {
                throw new IllegalArgumentException(
                        "Sprint 1 forbids message delivery; messageEnabled must be false");
            }
        }

        @Override public String kind() { return "UPSERT_HOTEL"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.HOTEL_CONFIG_MANAGE; }
        @Override public String resourceType() { return "HOTEL_CONFIG"; }
        @Override public UUID resourceId() { return hotelId; }
        @Override public UUID hotelId() { return hotelId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), hotelCode, displayName, timezone,
                    lifecycleStatus, Boolean.toString(collectionEnabled), Boolean.toString(messageEnabled));
        }
    }

    public record UpsertConnector(
            UUID hotelId,
            UUID connectorId,
            String adapterCode,
            String sourceCode,
            boolean enabled,
            String fixtureScenarioCode,
            int pollIntervalMinutes,
            String secretReference
    ) implements Mutation {
        public UpsertConnector {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            adapterCode = requireOneOf(
                    adapterCode, "adapterCode",
                    "MOCK_PMS", "MOCK_CTRIP", "MOCK_MEITUAN", "FILE_FIXTURE");
            sourceCode = requireOneOf(
                    sourceCode, "sourceCode", "PMS", "CTRIP", "MEITUAN", "OFFICIAL_EXPORT");
            fixtureScenarioCode = requireCode(fixtureScenarioCode, "fixtureScenarioCode");
            if (pollIntervalMinutes < 5 || pollIntervalMinutes > 60) {
                throw new IllegalArgumentException("pollIntervalMinutes must be between 5 and 60");
            }
            if (secretReference != null && !SECRET_REFERENCE.matcher(secretReference).matches()) {
                throw new IllegalArgumentException("secretReference must use a controlled opaque provider namespace");
            }
            if ("FILE_FIXTURE".equals(adapterCode) && secretReference != null) {
                throw new IllegalArgumentException(
                        "FILE_FIXTURE does not accept a secretReference");
            }
            if (!adapterMatchesSource(adapterCode, sourceCode)) {
                throw new IllegalArgumentException("adapterCode and sourceCode do not match");
            }
        }

        @Override public String kind() { return "UPSERT_CONNECTOR"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.CONNECTOR_CONFIG_MANAGE; }
        @Override public String resourceType() { return "CONNECTOR_CONFIG"; }
        @Override public UUID resourceId() { return connectorId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), connectorId.toString(), adapterCode,
                    sourceCode, Boolean.toString(enabled), fixtureScenarioCode,
                    Integer.toString(pollIntervalMinutes), secretReference == null ? "" : secretReference);
        }
    }

    public record UpsertInventoryPool(
            UUID hotelId,
            UUID inventoryPoolId,
            String physicalRoomTypeCode,
            String displayName,
            int physicalRoomCount
    ) implements Mutation {
        public UpsertInventoryPool {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(inventoryPoolId, "inventoryPoolId");
            physicalRoomTypeCode = requireCode(physicalRoomTypeCode, "physicalRoomTypeCode");
            displayName = requireDisplay(displayName, "displayName");
            if (physicalRoomCount < 1 || physicalRoomCount > 10000) {
                throw new IllegalArgumentException("physicalRoomCount must be between 1 and 10000");
            }
        }

        @Override public String kind() { return "UPSERT_INVENTORY_POOL"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.ROOM_MAPPING_MANAGE; }
        @Override public String resourceType() { return "INVENTORY_POOL"; }
        @Override public UUID resourceId() { return inventoryPoolId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), inventoryPoolId.toString(),
                    physicalRoomTypeCode, displayName, Integer.toString(physicalRoomCount));
        }
    }

    public record UpsertSellableProduct(
            UUID hotelId,
            UUID productId,
            UUID connectorId,
            String sourceCode,
            String externalProductCode,
            String displayName,
            String mealPlanCode
    ) implements Mutation {
        public UpsertSellableProduct {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(productId, "productId");
            Objects.requireNonNull(connectorId, "connectorId");
            sourceCode = requireOneOf(
                    sourceCode, "sourceCode", "PMS", "CTRIP", "MEITUAN", "OFFICIAL_EXPORT");
            externalProductCode = requireCode(externalProductCode, "externalProductCode");
            displayName = requireDisplay(displayName, "displayName");
            mealPlanCode = requireOneOf(mealPlanCode, "mealPlanCode", "ROOM_ONLY", "BREAKFAST_INCLUDED");
        }

        @Override public String kind() { return "UPSERT_SELLABLE_PRODUCT"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.ROOM_MAPPING_MANAGE; }
        @Override public String resourceType() { return "SELLABLE_PRODUCT"; }
        @Override public UUID resourceId() { return productId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), productId.toString(),
                    connectorId.toString(), sourceCode, externalProductCode, displayName, mealPlanCode);
        }
    }

    public record UpsertProductMapping(
            UUID hotelId,
            UUID mappingVersionId,
            UUID productId,
            UUID inventoryPoolId
    ) implements Mutation {
        public UpsertProductMapping {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(mappingVersionId, "mappingVersionId");
            Objects.requireNonNull(productId, "productId");
            Objects.requireNonNull(inventoryPoolId, "inventoryPoolId");
        }

        @Override public String kind() { return "UPSERT_PRODUCT_MAPPING"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.ROOM_MAPPING_MANAGE; }
        @Override public String resourceType() { return "PRODUCT_MAPPING"; }
        @Override public UUID resourceId() { return mappingVersionId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), mappingVersionId.toString(),
                    productId.toString(), inventoryPoolId.toString());
        }
    }

    public record UpsertRevenueTarget(
            UUID hotelId,
            UUID targetVersionId,
            LocalDate businessDate,
            BigDecimal roomRevenueTarget,
            BigDecimal targetAdr
    ) implements Mutation {
        public UpsertRevenueTarget {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(targetVersionId, "targetVersionId");
            Objects.requireNonNull(businessDate, "businessDate");
            roomRevenueTarget = positiveMoney(roomRevenueTarget, "roomRevenueTarget");
            targetAdr = positiveMoney(targetAdr, "targetAdr");
        }

        @Override public String kind() { return "UPSERT_REVENUE_TARGET"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.REVENUE_TARGET_MANAGE; }
        @Override public String resourceType() { return "REVENUE_TARGET"; }
        @Override public UUID resourceId() { return targetVersionId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), targetVersionId.toString(),
                    businessDate.toString(), roomRevenueTarget.toPlainString(), targetAdr.toPlainString());
        }
    }

    public record PacePointInput(
            LocalTime cutoffLocalTime,
            BigDecimal revenueProgressPercent,
            BigDecimal soldProgressPercent
    ) {
        public PacePointInput {
            Objects.requireNonNull(cutoffLocalTime, "cutoffLocalTime");
            revenueProgressPercent = percentage(revenueProgressPercent, "revenueProgressPercent");
            soldProgressPercent = percentage(soldProgressPercent, "soldProgressPercent");
        }
    }

    public record UpsertPaceCurve(
            UUID hotelId,
            UUID paceCurveVersionId,
            String curveCode,
            LocalDate validFrom,
            LocalDate validUntil,
            List<PacePointInput> points
    ) implements Mutation {
        public UpsertPaceCurve {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(paceCurveVersionId, "paceCurveVersionId");
            curveCode = requireCode(curveCode, "curveCode");
            Objects.requireNonNull(validFrom, "validFrom");
            if (validUntil != null && validUntil.isBefore(validFrom)) {
                throw new IllegalArgumentException("validUntil must not be before validFrom");
            }
            points = List.copyOf(points);
            if (points.size() < 2 || points.size() > 24) {
                throw new IllegalArgumentException("pace curve requires between 2 and 24 points");
            }
            long distinctTimes = points.stream().map(PacePointInput::cutoffLocalTime).distinct().count();
            if (distinctTimes != points.size()) {
                throw new IllegalArgumentException("pace curve cutoff times must be unique");
            }
        }

        @Override public String kind() { return "UPSERT_PACE_CURVE"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.PACE_CURVE_MANAGE; }
        @Override public String resourceType() { return "PACE_CURVE"; }
        @Override public UUID resourceId() { return paceCurveVersionId; }
        @Override public String canonicalForm() {
            String pointText = points.stream()
                    .sorted(java.util.Comparator.comparing(PacePointInput::cutoffLocalTime))
                    .map(point -> point.cutoffLocalTime() + "," +
                            point.revenueProgressPercent().toPlainString() + "," +
                            point.soldProgressPercent().toPlainString())
                    .collect(java.util.stream.Collectors.joining(";"));
            return String.join("|", kind(), hotelId.toString(), paceCurveVersionId.toString(),
                    curveCode, validFrom.toString(), validUntil == null ? "" : validUntil.toString(), pointText);
        }
    }

    public record TriggerSimulation(
            UUID hotelId,
            UUID runId,
            String scenarioCode
    ) implements Mutation {
        public TriggerSimulation {
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(runId, "runId");
            scenarioCode = requireOneOf(
                    scenarioCode, "scenarioCode",
                    "BASELINE", "INVENTORY_MISMATCH", "SOURCE_UNAVAILABLE", "LATE_BRIEF_REPLAY");
        }

        @Override public String kind() { return "TRIGGER_SIMULATION"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.SIMULATION_RUN_TRIGGER; }
        @Override public String resourceType() { return "SIMULATION_RUN"; }
        @Override public UUID resourceId() { return runId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), hotelId.toString(), runId.toString(), scenarioCode);
        }
    }

    public record InitializeSimulationHotel(
            UUID tenantId,
            UUID hotelId,
            UUID pmsConnectorId,
            UUID ctripConnectorId,
            UUID meituanConnectorId,
            String tenantCode,
            String tenantDisplayName,
            String hotelCode,
            String hotelDisplayName,
            String timezone
    ) implements Mutation {
        public InitializeSimulationHotel {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(pmsConnectorId, "pmsConnectorId");
            Objects.requireNonNull(ctripConnectorId, "ctripConnectorId");
            Objects.requireNonNull(meituanConnectorId, "meituanConnectorId");
            tenantCode = requireCode(tenantCode, "tenantCode");
            tenantDisplayName = requireDisplay(tenantDisplayName, "tenantDisplayName");
            hotelCode = requireCode(hotelCode, "hotelCode");
            hotelDisplayName = requireDisplay(hotelDisplayName, "hotelDisplayName");
            timezone = requireTimezone(timezone);
        }

        @Override public String kind() { return "INITIALIZE_SIMULATION_HOTEL"; }
        @Override public OtaPermission requiredPermission() { return OtaPermission.SIMULATION_RUN_TRIGGER; }
        @Override public String resourceType() { return "SIMULATION_HOTEL"; }
        @Override public UUID resourceId() { return hotelId; }
        @Override public UUID hotelId() { return hotelId; }
        @Override public String canonicalForm() {
            return String.join("|", kind(), tenantId.toString(), hotelId.toString(),
                    pmsConnectorId.toString(), ctripConnectorId.toString(), meituanConnectorId.toString(),
                    tenantCode, tenantDisplayName, hotelCode, hotelDisplayName, timezone);
        }
    }

    private static String requireCode(String value, String field) {
        if (value == null || !CODE.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a controlled uppercase code");
        }
        return value;
    }

    private static String requireDisplay(String value, String field) {
        if (value == null || !DISPLAY.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return value.strip();
    }

    private static String requireTimezone(String value) {
        if (value == null || !TIMEZONE.matcher(value).matches()) {
            throw new IllegalArgumentException("timezone must be an IANA timezone identifier");
        }
        try {
            java.time.ZoneId.of(value);
        } catch (java.time.DateTimeException exception) {
            throw new IllegalArgumentException("timezone must be an IANA timezone identifier", exception);
        }
        return value;
    }

    private static String requireOneOf(String value, String field, String... allowed) {
        if (value == null || java.util.Arrays.stream(allowed).noneMatch(value::equals)) {
            throw new IllegalArgumentException(field + " is not allowed");
        }
        return value;
    }

    private static boolean adapterMatchesSource(String adapterCode, String sourceCode) {
        return switch (adapterCode) {
            case "MOCK_PMS" -> sourceCode.equals("PMS");
            case "MOCK_CTRIP" -> sourceCode.equals("CTRIP");
            case "MOCK_MEITUAN" -> sourceCode.equals("MEITUAN");
            case "FILE_FIXTURE" -> sourceCode.equals("OFFICIAL_EXPORT");
            default -> false;
        };
    }

    private static BigDecimal positiveMoney(BigDecimal value, String field) {
        Objects.requireNonNull(value, field);
        if (value.scale() > 2 || value.signum() <= 0 || value.compareTo(new BigDecimal("100000000")) > 0) {
            throw new IllegalArgumentException(field + " must be positive money with at most two decimals");
        }
        return value;
    }

    private static BigDecimal percentage(BigDecimal value, String field) {
        Objects.requireNonNull(value, field);
        if (value.scale() > 4 || value.signum() < 0 || value.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException(field + " must be between 0 and 100");
        }
        return value;
    }
}
