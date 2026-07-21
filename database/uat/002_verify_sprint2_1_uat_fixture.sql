\set ON_ERROR_STOP on

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

DO $$
DECLARE
    region_count INTEGER;
    hotel_count INTEGER;
    account_count INTEGER;
    published_standard_count INTEGER;
    published_package_count INTEGER;
    published_rule_count INTEGER;
    expectation_count INTEGER;
BEGIN
    SELECT count(*) INTO region_count FROM org_unit
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001' AND unit_type = 'REGION';
    SELECT count(*) INTO hotel_count FROM org_unit
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001' AND unit_type = 'HOTEL';
    SELECT count(*) INTO account_count FROM user_account
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id IN (
        '19000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000005',
        '19000000-0000-0000-0000-000000000004','19000000-0000-0000-0000-000000000007',
        '19000000-0000-0000-0000-000000000008','19000000-0000-0000-0000-000000000002'
      );
    SELECT count(*) INTO published_standard_count FROM standard_version
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id IN ('27000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000002',
                 '27000000-0000-0000-0000-000000000003')
      AND lifecycle_status = 'PUBLISHED';
    SELECT count(*) INTO published_package_count FROM work_package_version
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id IN ('2a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000002',
                 '2a100000-0000-0000-0000-000000000003')
      AND lifecycle_status = 'PUBLISHED';
    SELECT count(*) INTO published_rule_count FROM rule_version
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id IN ('2b100000-0000-0000-0000-000000000001','2b100000-0000-0000-0000-000000000002',
                 '2b100000-0000-0000-0000-000000000003','2b100000-0000-0000-0000-000000000004',
                 '2b100000-0000-0000-0000-000000000005')
      AND lifecycle_status = 'PUBLISHED';
    SELECT count(*) INTO expectation_count FROM work_expectation
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id IN ('2a500000-0000-0000-0000-000000000001','2a500000-0000-0000-0000-000000000002',
                 '2a500000-0000-0000-0000-000000000003','2a500000-0000-0000-0000-000000000004',
                 '2a500000-0000-0000-0000-000000000005');

    IF region_count < 2 THEN RAISE EXCEPTION 'Expected >=2 regions, got %', region_count; END IF;
    IF hotel_count < 3 THEN RAISE EXCEPTION 'Expected >=3 hotels, got %', hotel_count; END IF;
    IF account_count <> 6 THEN RAISE EXCEPTION 'Expected 6 UAT accounts, got %', account_count; END IF;
    IF published_standard_count <> 3 THEN RAISE EXCEPTION 'Expected 3 published UAT standards, got %', published_standard_count; END IF;
    IF published_package_count <> 3 THEN RAISE EXCEPTION 'Expected 3 published UAT packages, got %', published_package_count; END IF;
    IF published_rule_count <> 5 THEN RAISE EXCEPTION 'Expected 5 published UAT rules, got %', published_rule_count; END IF;
    IF expectation_count <> 5 THEN RAISE EXCEPTION 'Expected 5 UAT expectations, got %', expectation_count; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM work_record
        WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
          AND id = '2e000000-0000-0000-0000-000000000001'
          AND position_assignment_id = '19200000-0000-0000-0000-000000000003'
          AND work_package_item_id = '2a200000-0000-0000-0000-000000000003'
          AND status = 'SUBMITTED'
    ) THEN RAISE EXCEPTION 'Scenario A housekeeping work record is missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = '30000000-0000-0000-0000-000000000001') THEN
        RAISE EXCEPTION 'Isolation control tenant is missing';
    END IF;
END $$;

SELECT 'flyway' AS check_name,
       (SELECT version FROM flyway_schema_history WHERE success = true ORDER BY installed_rank DESC LIMIT 1) AS actual,
       '13' AS expected
UNION ALL
SELECT 'main-regions', count(*)::text, '>=2' FROM org_unit
WHERE tenant_id = '10000000-0000-0000-0000-000000000001' AND unit_type = 'REGION'
UNION ALL
SELECT 'main-hotels', count(*)::text, '>=3' FROM org_unit
WHERE tenant_id = '10000000-0000-0000-0000-000000000001' AND unit_type = 'HOTEL'
UNION ALL
SELECT 'six-role-accounts', count(*)::text, '6' FROM user_account
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
    '19000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000005',
    '19000000-0000-0000-0000-000000000004','19000000-0000-0000-0000-000000000007',
    '19000000-0000-0000-0000-000000000008','19000000-0000-0000-0000-000000000002'
  )
UNION ALL
SELECT 'uat-expectations', count(*)::text, '5' FROM work_expectation
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id::text LIKE '2a500000-%';
