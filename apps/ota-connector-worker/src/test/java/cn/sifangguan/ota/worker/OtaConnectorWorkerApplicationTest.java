package cn.sifangguan.ota.worker;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "spring.main.web-application-type=none")
class OtaConnectorWorkerApplicationTest {
    @Test
    void startsWithoutARealConnectorOrExternalSystem() {
    }
}
