import { describe, expect, it } from "vitest";
import { createGameLogParser } from "./gameLog";

const time = new Date(2026, 0, 1, 12, 2, 28).getTime();

describe("game log parser", () => {
  it("turns log4j XML events into readable lines, across chunks", () => {
    const parse = createGameLogParser();
    const first = parse([
      `  <log4j:Event logger="ave" timestamp="${time}" level="INFO" thread="Client thread">`,
      "    <log4j:Message><![CDATA[Setting user: Steve]]></log4j:Message>",
    ]);
    expect(first).toEqual([]);
    expect(parse(["  </log4j:Event>"])).toEqual([
      "[12:02:28] [Client thread/INFO]: Setting user: Steve",
    ]);
  });

  it("includes stack traces and passes plain lines through", () => {
    const parse = createGameLogParser();
    expect(
      parse([
        "ALSA lib pcm.c: Unknown PCM default",
        `<log4j:Event logger="x" timestamp="${time}" level="ERROR" thread="Render">`,
        "<log4j:Message><![CDATA[Crash]]></log4j:Message>",
        "<log4j:Throwable><![CDATA[java.lang.RuntimeException: boom",
        "\tat a.b(C.java:1)]]></log4j:Throwable>",
        "</log4j:Event>",
      ]),
    ).toEqual([
      "ALSA lib pcm.c: Unknown PCM default",
      "[12:02:28] [Render/ERROR]: Crash",
      "java.lang.RuntimeException: boom",
      "\tat a.b(C.java:1)",
    ]);
  });
});
