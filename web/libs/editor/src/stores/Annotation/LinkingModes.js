import { types } from "mobx-state-tree";
import Constants from "../../core/Constants";
import { CommentMode } from "./LinkingModes/CommentMode";
import { RelationMode } from "./LinkingModes/RelationMode";
import {
  faivvRelationDebug,
  summarizeRegionForRelation,
} from "../../tags/object/Video/faivvRelationDebug";

export const CREATE_RELATION_MODE = RelationMode.key;
export const LINK_COMMENT_MODE = CommentMode.key;

const LinkingModeUnion = types.union(CommentMode.model, RelationMode.model);

export const LinkingModes = types
  .model("LinkingModes", {
    linkingModes: types.optional(types.map(LinkingModeUnion), () => ({
      [RelationMode.key]: RelationMode.model.create({}),
      [CommentMode.key]: CommentMode.model.create({}),
    })),
  })
  .volatile((self) => {
    return {
      linkingMode: false,
    };
  })
  .views((self) => ({
    get currentLinkingMode() {
      return self.linkingMode && self.linkingModes.has(self.linkingMode)
        ? self.linkingModes.get(self.linkingMode)
        : null;
    },
    get isLinkingMode() {
      return !!self.linkingMode;
    },
    // @deprecated
    get relationMode() {
      console.warn("`relationMode` is deprecated. Use `isLinkingMode` instead.");
      return self.isLinkingMode;
    },
  }))
  .actions((self) => {
    return {
      startLinkingMode(linkingModeName, obj) {
        if (self.isLinkingMode) {
          self.stopLinkingMode();
        }
        self.linkingMode = linkingModeName;
        if (!self.currentLinkingMode) {
          faivvRelationDebug("link.start.fail", {
            mode: linkingModeName,
            reason: "no_currentLinkingMode",
            region: summarizeRegionForRelation(obj),
          });
          self.linkingMode = false;
          return;
        }
        self.currentLinkingMode.start(obj);
        faivvRelationDebug("link.start", {
          mode: linkingModeName,
          region: summarizeRegionForRelation(obj),
          hint: "다음: Outliner에서 상대 region 단일 클릭 (또는 shape onClickRegion)",
        });

        document.body.style.cursor = Constants.CHOOSE_CURSOR;
      },

      stopLinkingMode() {
        document.body.style.cursor = Constants.DEFAULT_CURSOR;

        if (self.currentLinkingMode) {
          self.currentLinkingMode.stop();
        }

        faivvRelationDebug("link.stop", {
          wasMode: self.linkingMode,
        });
        self.linkingMode = false;
      },

      addLinkedRegion(region) {
        faivvRelationDebug("link.add", {
          mode: self.linkingMode,
          hasModeHandler: !!self.currentLinkingMode,
          region: summarizeRegionForRelation(region),
          sourceRegion: summarizeRegionForRelation(self.currentLinkingMode?.region),
        });
        if (self.currentLinkingMode) {
          self.currentLinkingMode.addLinkedRegion?.(region);
        } else {
          faivvRelationDebug("link.add.skipped", {
            reason: "no_currentLinkingMode",
            region: summarizeRegionForRelation(region),
          });
        }
      },

      addLinkedResult(region) {
        if (self.currentLinkingMode) {
          self.currentLinkingMode.addLinkedResult?.(region);
        }
      },

      // @deprecated Use `startLinkingMode(CREATE_RELATION_MODE, obj)` instead
      startRelationMode(obj) {
        console.warn("`startRelationMode` is deprecated. Use `startLinkingMode(CREATE_RELATION_MODE, obj)` instead.");
        self.startLinkingMode(RelationMode.key, obj);
      },
      // @deprecated Use `stopLinkingMode` instead
      stopRelationMode() {
        console.warn("`stopRelationMode` is deprecated. Use `stopLinkingMode` instead.");
        self.stopLinkingMode();
      },
    };
  });
