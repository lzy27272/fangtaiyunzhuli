package cn.sifangguan.hotelaios.performance;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kpi")
public class KpiAssessmentController {
    private final KpiAssessmentService service;

    public KpiAssessmentController(KpiAssessmentService service) {
        this.service = service;
    }

    @GetMapping("/relations")
    public List<Map<String, Object>> relations(
            @RequestParam(required = false) UUID employeeId,
            @RequestParam(required = false) String status
    ) {
        return service.relations(employeeId, status);
    }

    @PostMapping("/relations")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createRelation(@Valid @RequestBody KpiModels.CreateRelation request) {
        return service.createRelation(request);
    }

    @GetMapping("/periods")
    public List<Map<String, Object>> periods() {
        return service.periods();
    }

    @PostMapping("/periods/actions/generate")
    public Map<String, Object> generate(@Valid @RequestBody KpiModels.GeneratePeriod request) {
        return service.generate(request);
    }

    @PostMapping("/periods/{periodId}/actions/lock")
    public Map<String, Object> lockPeriod(
            @PathVariable UUID periodId,
            @Valid @RequestBody KpiModels.LockPeriod request
    ) {
        return service.lockPeriod(periodId, request);
    }

    @GetMapping("/scorecards")
    public List<Map<String, Object>> scorecards(
            @RequestParam(required = false) UUID periodId,
            @RequestParam(required = false) String cardType,
            @RequestParam(required = false) String status
    ) {
        return service.scorecards(periodId, cardType, status);
    }

    @GetMapping("/scorecards/{scorecardId}")
    public Map<String, Object> scorecard(@PathVariable UUID scorecardId) {
        return service.scorecard(scorecardId);
    }

    @PostMapping("/scorecards/{scorecardId}/manual-scores")
    public Map<String, Object> submitManualScore(
            @PathVariable UUID scorecardId,
            @Valid @RequestBody KpiModels.SubmitManualScore request
    ) {
        return service.submitManualScore(scorecardId, request);
    }

    @PostMapping("/scorecards/{scorecardId}/reviews")
    public Map<String, Object> reviewScorecard(
            @PathVariable UUID scorecardId,
            @Valid @RequestBody KpiModels.ScorecardReview request
    ) {
        return service.reviewScorecard(scorecardId, request);
    }

    @PostMapping("/scorecards/{scorecardId}/disputes")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createDispute(
            @PathVariable UUID scorecardId,
            @Valid @RequestBody KpiModels.CreateDispute request
    ) {
        return service.createDispute(scorecardId, request);
    }

    @PostMapping("/disputes/{disputeId}/actions/resolve")
    public Map<String, Object> resolveDispute(
            @PathVariable UUID disputeId,
            @Valid @RequestBody KpiModels.ResolveDispute request
    ) {
        return service.resolveDispute(disputeId, request);
    }

    @GetMapping("/corrections")
    public List<Map<String, Object>> corrections(
            @RequestParam(required = false) UUID scorecardId,
            @RequestParam(required = false) String status
    ) {
        return service.corrections(scorecardId, status);
    }

    @PostMapping("/scorecards/{scorecardId}/corrections")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createCorrection(
            @PathVariable UUID scorecardId,
            @Valid @RequestBody KpiModels.CreateCorrection request
    ) {
        return service.createCorrection(scorecardId, request);
    }

    @PostMapping("/corrections/{correctionId}/actions/resolve")
    public Map<String, Object> resolveCorrection(
            @PathVariable UUID correctionId,
            @Valid @RequestBody KpiModels.ResolveCorrection request
    ) {
        return service.resolveCorrection(correctionId, request);
    }

    @PostMapping("/bonus-bases")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> setBonusBase(@Valid @RequestBody KpiModels.SetBonusBase request) {
        return service.setBonusBase(request);
    }

    @GetMapping("/settlements")
    public List<Map<String, Object>> settlements(@RequestParam(required = false) UUID periodId) {
        return service.settlements(periodId);
    }
}
