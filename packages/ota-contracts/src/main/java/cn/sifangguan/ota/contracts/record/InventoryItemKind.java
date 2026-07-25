package cn.sifangguan.ota.contracts.record;

/**
 * Distinguishes a PMS physical room type from an OTA sellable product.
 * OTA products may share one physical inventory pool and must never be summed.
 */
public enum InventoryItemKind {
    PHYSICAL_ROOM_TYPE,
    SELL_PRODUCT
}
