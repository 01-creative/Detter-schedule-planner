/**
 * ID 生成统一走 @detter/shared 的 uuidv7。
 *
 * 为什么不在后端另造一套：离线优先意味着客户端也要能生成主键，
 * 两端必须用同一个算法，否则排序/去重的假设就会分叉。
 */
export { isUuid, shortId, uuidv7, uuidv7Time } from "@detter/shared";
