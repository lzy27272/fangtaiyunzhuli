package cn.sifangguan.hotelaios.iam;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/iam")
public class IamController {
    private final IamService service;

    public IamController(IamService service) {
        this.service = service;
    }

    @GetMapping("/me")
    public IamModels.Me me() {
        return service.me();
    }

    @GetMapping("/permissions")
    public List<Map<String, Object>> permissions() {
        return service.listPermissions();
    }

    @GetMapping("/roles")
    public List<Map<String, Object>> roles() {
        return service.listRoles();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createRole(@Valid @RequestBody IamModels.CreateRole request) {
        return service.createRole(request);
    }

    @PutMapping("/roles/{roleId}/permissions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setPermissions(@PathVariable UUID roleId, @Valid @RequestBody IamModels.SetPermissions request) {
        service.setPermissions(roleId, request);
    }

    @PostMapping("/role-assignments")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> grantRole(@Valid @RequestBody IamModels.GrantRole request) {
        return service.grantRole(request);
    }
}
