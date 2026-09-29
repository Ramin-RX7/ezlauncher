/**
 * Mojang's log config makes the game print log4j XML events, meant for launchers:
 *
 *   <log4j:Event logger="ave" timestamp="1790599348429" level="INFO" thread="Client thread">
 *     <log4j:Message><![CDATA[Setting user: Steve]]></log4j:Message>
 *   </log4j:Event>
 *
 * This turns them back into readable lines, e.g. `[12:02:28] [Client thread/INFO]: Setting user: Steve`.
 * Lines that aren't part of an event (plain stdout, native library noise) pass through unchanged.
 */
export function createGameLogParser(): (lines: readonly string[]) => string[] {
  let event: string[] | undefined;

  const attr = (text: string, name: string): string | undefined =>
    new RegExp(`${name}="([^"]*)"`).exec(text)?.[1];

  const cdata = (text: string, tag: string): string | undefined => {
    const match = new RegExp(
      `<log4j:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></log4j:${tag}>`,
    ).exec(text);
    return match?.[1];
  };

  const format = (xml: string): string[] => {
    const time = Number(attr(xml, "timestamp"));
    const clock = Number.isFinite(time)
      ? new Date(time).toTimeString().slice(0, 8)
      : "--:--:--";
    const head = `[${clock}] [${attr(xml, "thread") ?? "?"}/${attr(xml, "level") ?? "INFO"}]: `;
    const message = cdata(xml, "Message") ?? "";
    const throwable = cdata(xml, "Throwable");
    const text = throwable ? `${message}\n${throwable}` : message;
    return `${head}${text}`.split(/\r?\n/).filter((l) => l.length > 0);
  };

  return (lines) => {
    const out: string[] = [];
    for (const line of lines) {
      if (event) {
        event.push(line);
        if (line.includes("</log4j:Event>")) {
          out.push(...format(event.join("\n")));
          event = undefined;
        }
      } else if (line.trimStart().startsWith("<log4j:Event")) {
        event = [line];
        if (line.includes("</log4j:Event>")) {
          out.push(...format(line));
          event = undefined;
        }
      } else {
        out.push(line);
      }
    }
    return out;
  };
}
