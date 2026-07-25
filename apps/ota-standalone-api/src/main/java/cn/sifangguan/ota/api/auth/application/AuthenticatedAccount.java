package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.LocalAccount;

import java.util.UUID;

public record AuthenticatedAccount(LocalAccount account, UUID sessionId) {
}
