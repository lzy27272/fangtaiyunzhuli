package cn.sifangguan.hotelaios;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

class Sprint21LiveUatServerLifecycleTest {
    @Test
    void shutdownListenerRunsAfterDirtiesContextInReverseAfterTestClassOrder() {
        int shutdownOrder = new Sprint21LiveUatServerTest.InfrastructureShutdownListener().getOrder();

        assertThat(shutdownOrder)
                .isEqualTo(DirtiesContextTestExecutionListener.ORDER - 1)
                .isLessThan(DirtiesContextTestExecutionListener.ORDER);
    }

    @Test
    void closesApplicationBeforeDatabase() throws Exception {
        List<String> closeOrder = new ArrayList<>();

        UatResourceCloser.closeInOrder(
                () -> closeOrder.add("application"),
                () -> closeOrder.add("database")
        );

        assertThat(closeOrder).containsExactly("application", "database");
    }

    @Test
    void stillClosesDatabaseAndPreservesFailuresWhenApplicationCloseFails() {
        List<String> closeOrder = new ArrayList<>();
        IllegalStateException applicationFailure = new IllegalStateException("application close failed");
        IllegalArgumentException databaseFailure = new IllegalArgumentException("database close failed");

        Throwable thrown = catchThrowable(() -> UatResourceCloser.closeInOrder(
                () -> {
                    closeOrder.add("application");
                    throw applicationFailure;
                },
                () -> {
                    closeOrder.add("database");
                    throw databaseFailure;
                }
        ));

        assertThat(closeOrder).containsExactly("application", "database");
        assertThat(thrown).isSameAs(applicationFailure);
        assertThat(thrown.getSuppressed()).containsExactly(databaseFailure);
    }
}
