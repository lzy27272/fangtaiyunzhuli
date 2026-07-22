package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.AiDecisionRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.AiDecisionView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/ai/recommendations")
public class AiRecommendationDecisionController {
    private final AiRecommendationDecisionService service;

    public AiRecommendationDecisionController(AiRecommendationDecisionService service) {
        this.service = service;
    }

    @PostMapping("/{recommendationId}/decisions")
    @ResponseStatus(HttpStatus.CREATED)
    public AiDecisionView decide(
            @PathVariable UUID recommendationId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody AiDecisionRequest request
    ) {
        return service.decide(recommendationId, request, idempotencyKey);
    }
}
