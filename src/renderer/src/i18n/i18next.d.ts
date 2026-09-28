import "i18next";
import type { defaultNS, resources } from ".";

// Makes `t('some.key')` type-checked against en.json.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)["en"];
  }
}
