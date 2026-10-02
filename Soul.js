/*******************************

脚本名称：Soul 6.x 去广告净化版（保留群聊派对）
适配基线：Soul iOS 6.38.0
更新时间：2026-10-02
适用工具：Quantumult X

脚本功能：
1. 去除 Soul 开屏广告
2. 去除页面悬浮推广、首页引导卡片和官方运营模块
3. 去除评论区礼物榜入口
4. 去除星球页已确认的游戏推广
5. 去除“我的”页面礼物墙、宠物星球、商城入口
6. 默认隐藏热 Soul 话题、更新提示和青少年模式弹窗
7. 拦截 Soul 自有广告素材及落地页域名

群聊派对保护：
1. 不拦截 chatroom、群聊或直播房间接口
2. 不拦截 /live/planet/recListV2
3. 不删除“群聊派对”和“兴趣群组”入口
4. 不修改群聊派对卡片样式
5. 若待清空的数据中检测到群聊派对标记，则整段数据放行

安全说明：
本脚本不修改 VIP、超级星人、飞行包、私聊限制、访客记录、
恋爱铃、订阅、余额、礼物数量或其他付费/平台权限。

使用方法：
1. 将本文件保存为 Soul.js，放进 Quantumult X 的 Scripts 文件夹。
2. 将下方对应规则复制进 Quantumult X 主配置的同名小节。
3. 安装并完全信任 Quantumult X 的 MitM 证书。
4. 若上传到 GitHub 使用远程脚本，请把规则末尾的 Soul.js
   换成你自己的 raw.githubusercontent.com 原始文件地址。

[rewrite_local]

# 开屏广告：直接返回空 JSON
^https:\/\/ssp\.soulapp\.cn\/api\/q(?:[/?]|$) url reject-dict

# 页面推广、礼物榜、热门话题、更新提示、青少年弹窗、星球推广及“我的”页面商业入口
^https:\/\/(?:api-a|api-user|api-account|gateway-mobile-gray|post)\.soulapp\.cn\/(?:v2\/post\/gift\/list|hot\/soul\/rank|mobile\/app\/version\/queryIos|furion\/position\/content|teenager\/config|official\/scene\/module|v[0-9]+\/post\/homepage\/guide\/card|v6\/planet\/config|homepage\/diamond\/position\/info)(?:[/?]|$) url script-response-body Soul.js

[filter_local]

# Soul 自有广告素材与广告落地页
host, ad-h5-cdn.soulapp.cn, reject
host, ad-h5-station-cdn.soulapp.cn, reject
host, ad-r.soulapp.cn, reject
host, soul-ad.soulapp.cn, reject

[mitm]

# 只解密脚本需要的精确域名；不加入 chat-live / api-chat，避免影响群聊和私聊
hostname = %APPEND% api-a.soulapp.cn, api-user.soulapp.cn, api-account.soulapp.cn, gateway-mobile-gray.soulapp.cn, post.soulapp.cn, ssp.soulapp.cn

*******************************/

(function () {
  "use strict";

  /* Quantumult X 提供的当前请求 URL 与响应正文。 */
  var url = (typeof $request !== "undefined" && $request.url) || "";
  var body = (typeof $response !== "undefined" && $response.body) || "";

  /* 无响应正文时直接放行，防止脚本异常。 */
  if (!body) {
    return $done({});
  }

  var obj;
  try {
    obj = JSON.parse(body);
  } catch (error) {
    /* 非 JSON 响应不处理。 */
    console.log("[Soul 去广告] 非 JSON 响应，已放行：" + url);
    return $done({});
  }

  var changed = false;
  var reasons = [];

  function markChanged(reason) {
    changed = true;
    if (reason) reasons.push(reason);
  }

  function matchPath(regexp) {
    return regexp.test(url);
  }

  /*
   * 群聊派对保护标记。
   * JSON 中只要出现这些标题、业务代码或链接特征，就不整段清空。
   */
  var partyMarkers = [
    "群聊派对",
    "兴趣群组",
    "chatroom",
    "chat_room",
    "groupchat",
    "group_chat",
    "party"
  ];

  /*
   * 递归检查对象内是否包含群聊派对标记。
   * JSON 不会包含循环引用；仍限制深度，避免超大响应产生额外开销。
   */
  function containsPartyMarker(value, depth) {
    if (depth > 10 || value === null || typeof value === "undefined") {
      return false;
    }

    if (typeof value === "string") {
      var text = value.toLowerCase();
      for (var i = 0; i < partyMarkers.length; i++) {
        if (text.indexOf(partyMarkers[i].toLowerCase()) !== -1) {
          return true;
        }
      }
      return false;
    }

    if (Array.isArray(value)) {
      for (var j = 0; j < value.length; j++) {
        if (containsPartyMarker(value[j], depth + 1)) return true;
      }
      return false;
    }

    if (typeof value === "object") {
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (containsPartyMarker(key, depth + 1) ||
            containsPartyMarker(value[key], depth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  /* 判断单张卡片是不是需要完整保留的群聊派对/兴趣群组卡片。 */
  function isPartyCard(card) {
    return !!(card && containsPartyMarker(card, 0));
  }

  /*
   * 清空 data，但保留 code、message 等外层协议字段。
   * 如果 data 中包含群聊派对标记，则出于兼容性考虑整段放行。
   */
  function clearDataSafely(reason) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, "data")) return;

    if (containsPartyMarker(obj.data, 0)) {
      console.log("[Soul 去广告] 检测到群聊派对内容，跳过清空：" + reason);
      return;
    }

    if (Array.isArray(obj.data)) {
      if (obj.data.length === 0) return;
      obj.data = [];
    } else if (obj.data && typeof obj.data === "object") {
      if (Object.keys(obj.data).length === 0) return;
      obj.data = {};
    } else {
      if (obj.data === null) return;
      obj.data = null;
    }

    markChanged(reason);
  }

  /* 过滤数组并记录是否发生变化。 */
  function filterArray(owner, key, keep, reason) {
    if (!owner || !Array.isArray(owner[key])) return;

    var oldLength = owner[key].length;
    owner[key] = owner[key].filter(keep);

    if (owner[key].length !== oldLength) {
      markChanged(reason);
    }
  }

  /*
   * ============================================================
   * 一、整段清空的广告/干扰接口
   * ============================================================
   */

  // 评论区礼物榜入口；不会修改礼物余额或礼物数量。
  if (matchPath(/\/v2\/post\/gift\/list(?:[/?]|$)/)) {
    clearDataSafely("评论区礼物榜");
  }

  // 热 Soul 话题。
  if (matchPath(/\/hot\/soul\/rank(?:[/?]|$)/)) {
    clearDataSafely("热 Soul 话题");
  }

  // iOS 版本更新提示。
  if (matchPath(/\/mobile\/app\/version\/queryIos(?:[/?]|$)/)) {
    clearDataSafely("版本更新提示");
  }

  // 页面悬浮推广位。
  if (matchPath(/\/furion\/position\/content(?:[/?]|$)/)) {
    clearDataSafely("页面悬浮推广");
  }

  // 青少年模式配置弹窗。此项只隐藏弹窗，不伪造年龄或账户状态。
  if (matchPath(/\/teenager\/config(?:[/?]|$)/)) {
    clearDataSafely("青少年模式弹窗");
  }

  // 官方运营场景模块。
  if (matchPath(/\/official\/scene\/module(?:[/?]|$)/)) {
    clearDataSafely("官方运营模块");
  }

  // 首页引导或活动推广卡片，兼容 v1、v2……等接口版本。
  if (matchPath(/\/v\d+\/post\/homepage\/guide\/card(?:[/?]|$)/)) {
    clearDataSafely("首页引导卡片");
  }

  /*
   * ============================================================
   * 二、星球页推广清理
   * ============================================================
   *
   * 这里不再把“群聊派对”和“兴趣群组”列为推广项。
   * 对这两类卡片完整保留，并且不修改它们的 style。
   */
  if (matchPath(/\/v6\/planet\/config(?:[/?]|$)/)) {
    var removableTitles = {
      "异世界回响": true,
      "狼人魅影": true,
      "梦想海岛王": true,
      "幻想星球": true,
      "爆弹喵": true,
      "星球实验室": true
    };

    var planet = obj && obj.data;

    if (planet) {
      // 清理顶部游戏卡片；群聊派对/兴趣群组卡片优先保留。
      if (planet.gameInfo) {
        filterArray(planet.gameInfo, "gameCards", function (card) {
          if (isPartyCard(card)) return true;
          return !(card && removableTitles[card.title]);
        }, "星球页游戏推广");
      }

      // 清理星球主卡片；群聊派对/兴趣群组卡片优先保留。
      filterArray(planet, "coreCards", function (card) {
        if (isPartyCard(card)) return true;
        return !(card && removableTitles[card.title]);
      }, "星球页主推广");

      if (Array.isArray(planet.coreCards)) {
        planet.coreCards.forEach(function (card) {
          /* 群聊派对相关主卡片保持原样，包括其二级入口和 style。 */
          if (isPartyCard(card)) return;

          // 非群聊卡片内部，移除已确认的游戏推广入口。
          filterArray(card, "secondCards", function (subCard) {
            if (isPartyCard(subCard)) return true;
            return !(subCard && removableTitles[subCard.title]);
          }, "星球页二级游戏推广");

          // 仅调整非群聊推广卡片的突出样式。
          if (card && card.style === 2) {
            card.style = 1;
            markChanged("普通星球卡片样式");
          }
        });
      }
    }
  }

  /*
   * ============================================================
   * 三、“我的”页面商业入口
   * ============================================================
   * 使用稳定 code 精确删除，不做文字模糊匹配。
   */
  if (matchPath(/\/homepage\/diamond\/position\/info(?:[/?]|$)/)) {
    var blockedProfileCodes = {
      "GIFT_WALL": true, // 礼物墙
      "PET_PLANET": true, // 宠物星球
      "SHOP": true        // 商城
    };

    if (obj && Array.isArray(obj.data)) {
      var oldCount = obj.data.length;

      obj.data = obj.data.filter(function (item) {
        /* 如果未来群聊派对入口混入此数组，也一律优先保留。 */
        if (isPartyCard(item)) return true;
        return !(item && blockedProfileCodes[item.code]);
      });

      if (obj.data.length !== oldCount) {
        markChanged("我的页面商业入口");
      }
    }
  }

  /*
   * ============================================================
   * 四、输出处理后的结果
   * ============================================================
   */
  if (changed) {
    console.log("[Soul 去广告] 已处理：" + reasons.join("、"));
    return $done({ body: JSON.stringify(obj) });
  }

  /* 没有实际改动时让 Quantumult X 原样返回响应。 */
  return $done({});
})();
