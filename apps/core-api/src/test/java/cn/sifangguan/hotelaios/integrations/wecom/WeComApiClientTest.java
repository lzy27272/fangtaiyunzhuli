package cn.sifangguan.hotelaios.integrations.wecom;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.URI;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.hamcrest.Matchers.containsString;

class WeComApiClientTest {
    @Test
    void usesOfficialTokenAndOauthIdentityPaths() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        WeComApiClient client = new WeComApiClient(builder, WeComProtocolTest.properties());
        server.expect(once(), requestTo(containsString("/cgi-bin/gettoken?")))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"errcode\":0,\"access_token\":\"token-1\",\"expires_in\":7200}",
                        MediaType.APPLICATION_JSON));
        server.expect(once(), requestTo(containsString("/cgi-bin/auth/getuserinfo?")))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"errcode\":0,\"UserId\":\"member-1\"}", MediaType.APPLICATION_JSON));

        assertThat(client.exchangeOAuthCode("provider-code")).isEqualTo("member-1");
        server.verify();
    }

    @Test
    void transportExceptionsDoNotRetainSecretUriOrCause() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        WeComApiClient client = new WeComApiClient(builder, WeComProtocolTest.properties());
        server.expect(requestTo(containsString("/cgi-bin/gettoken?")))
                .andRespond(withException(new IOException(
                        "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpsecret=corp-secret-value")));

        assertThatThrownBy(() -> client.exchangeOAuthCode("provider-code"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining("corp-secret-value")
                .hasNoCause();
    }

    @Test
    void refreshesAnExpiredTokenOnce() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        WeComApiClient client = new WeComApiClient(builder, WeComProtocolTest.properties());
        server.expect(requestTo(containsString("/cgi-bin/gettoken?")))
                .andRespond(withSuccess("{\"errcode\":0,\"access_token\":\"token-old\",\"expires_in\":7200}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(containsString("access_token=token-old")))
                .andRespond(withSuccess("{\"errcode\":42001,\"errmsg\":\"expired\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(containsString("/cgi-bin/gettoken?")))
                .andRespond(withSuccess("{\"errcode\":0,\"access_token\":\"token-new\",\"expires_in\":7200}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(containsString("access_token=token-new")))
                .andRespond(withSuccess("{\"errcode\":0,\"UserId\":\"member-1\"}", MediaType.APPLICATION_JSON));

        assertThat(client.exchangeOAuthCode("provider-code")).isEqualTo("member-1");
        server.verify();
    }

    @Test
    void treatsInvalidRecipientsAsDeliveryFailure() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        WeComApiClient client = new WeComApiClient(builder, WeComProtocolTest.properties());
        server.expect(requestTo(containsString("/cgi-bin/gettoken?")))
                .andRespond(withSuccess("{\"errcode\":0,\"access_token\":\"token-1\",\"expires_in\":7200}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(containsString("/cgi-bin/message/send?")))
                .andRespond(withSuccess("{\"errcode\":0,\"invaliduser\":\"missing-user\"}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.sendApplicationTaskLink(
                "missing-user", "Task", "Open task", URI.create("https://api.example.test/task")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("rejected one or more recipients")
                .hasMessageNotContaining("missing-user");
    }
}
