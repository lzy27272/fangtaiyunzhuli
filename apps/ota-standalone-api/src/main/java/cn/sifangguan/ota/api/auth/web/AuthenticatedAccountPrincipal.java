package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.auth.application.AccountView;

import java.util.UUID;

public record AuthenticatedAccountPrincipal(AccountView account, UUID sessionId) {
}
