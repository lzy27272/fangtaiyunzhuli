package cn.sifangguan.hotelaios.organization;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/org")
public class OrganizationController {
    private final OrganizationService service;

    public OrganizationController(OrganizationService service) {
        this.service = service;
    }

    @GetMapping("/units")
    public List<Map<String, Object>> orgUnits(@RequestParam(required = false) String type) {
        return service.listOrgUnits(type);
    }

    @PostMapping("/units")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createOrgUnit(@Valid @RequestBody OrganizationModels.CreateOrgUnit request) {
        return service.createOrgUnit(request);
    }

    @PutMapping("/units/{orgUnitId}")
    public Map<String, Object> updateOrgUnit(
            @PathVariable UUID orgUnitId,
            @Valid @RequestBody OrganizationModels.UpdateOrgUnit request
    ) {
        return service.updateOrgUnit(orgUnitId, request);
    }

    @DeleteMapping("/units/{orgUnitId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOrgUnit(@PathVariable UUID orgUnitId) {
        service.deleteOrgUnit(orgUnitId);
    }

    @GetMapping("/positions")
    public List<Map<String, Object>> positions() {
        return service.listPositions();
    }

    @PostMapping("/positions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createPosition(@Valid @RequestBody OrganizationModels.CreatePosition request) {
        return service.createPosition(request);
    }

    @PutMapping("/positions/{positionId}")
    public Map<String, Object> updatePosition(
            @PathVariable UUID positionId,
            @Valid @RequestBody OrganizationModels.UpdatePosition request
    ) {
        return service.updatePosition(positionId, request);
    }

    @DeleteMapping("/positions/{positionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePosition(@PathVariable UUID positionId) {
        service.deletePosition(positionId);
    }

    @GetMapping("/employees")
    public List<Map<String, Object>> employees() {
        return service.listEmployees();
    }

    @PostMapping("/employees")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createEmployee(@Valid @RequestBody OrganizationModels.CreateEmployee request) {
        return service.createEmployee(request);
    }

    @PutMapping("/employees/{employeeId}")
    public Map<String, Object> updateEmployee(
            @PathVariable UUID employeeId,
            @Valid @RequestBody OrganizationModels.UpdateEmployee request
    ) {
        return service.updateEmployee(employeeId, request);
    }

    @DeleteMapping("/employees/{employeeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEmployee(@PathVariable UUID employeeId) {
        service.deleteEmployee(employeeId);
    }

    @PostMapping("/employees/{employeeId}/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> assignPosition(
            @PathVariable UUID employeeId,
            @Valid @RequestBody OrganizationModels.CreatePositionAssignment request
    ) {
        return service.assignPosition(employeeId, request);
    }
}
