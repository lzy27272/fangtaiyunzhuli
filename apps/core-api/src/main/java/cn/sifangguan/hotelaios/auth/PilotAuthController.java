package cn.sifangguan.hotelaios.auth;

import jakarta.validation.Valid;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "app.security.local-login.enabled", havingValue = "true")
public class PilotAuthController {
    private final PilotAuthService service;

    public PilotAuthController(PilotAuthService service) {
        this.service = service;
    }

    @PostMapping("/login")
    public PilotAuthModels.LoginResponse login(@Valid @RequestBody PilotAuthModels.LoginRequest request) {
        return service.login(request);
    }

    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@Valid @RequestBody PilotAuthModels.ChangePasswordRequest request) {
        service.changePassword(request);
    }
}
