"use client";

import React from "react";

/**
 * Renderer markdown NHẸ cho message dạng text của Copilot (không thêm dependency).
 * LLM hay trả lời kèm **đậm**, `code`, gạch đầu dòng và bảng `| a | b |` —
 * trước đây render plain text nên user nhìn thấy nguyên ký tự `**` và `|`.
 *
 * Nội dung "giàu" (có bảng — vd hồ sơ học viên) được gom vào MỘT card duy nhất
 * (khung bo góc kiểu ResultCardShell), các phần ngăn nhau bằng đường kẻ mảnh.
 * Nội dung thuần văn bản vẫn render như tin nhắn thường.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(
        <strong
          key={`${keyPrefix}-b${index}`}
          className="font-semibold text-zinc-900"
        >
          {match[1]}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${index}`}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-700"
        >
          {match[2]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
    index += 1;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line.trim());

// Dòng ngăn cách header của bảng markdown: |---|---| (có thể kèm dấu :).
const isSeparatorLine = (line: string) =>
  /^\s*\|?[\s:|\-]+\|?\s*$/.test(line) && line.includes("-");

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isListLine = (line: string) => /^\s*(?:[-•*])\s+/.test(line);

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; header: string[] | null; rows: string[][] }
  | {
      kind: "courseClasses";
      groups: Array<{
        course: string;
        classes: Array<{ name: string; type: string | null }>;
      }>;
      classCount: number;
    };

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isTableLine(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const hasSeparator =
        tableLines.length > 1 && isSeparatorLine(tableLines[1]);
      const header = hasSeparator ? splitRow(tableLines[0]) : null;
      const bodyLines = hasSeparator ? tableLines.slice(2) : tableLines;
      const rows = bodyLines
        .filter((row) => !isSeparatorLine(row))
        .map(splitRow);
      if (header || rows.length) {
        blocks.push({ kind: "table", header, rows });
      }
      continue;
    }

    if (isListLine(line)) {
      const items: string[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-•*])\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableLine(lines[i]) &&
      !isListLine(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

const isKeyValueTable = (block: Extract<Block, { kind: "table" }>) =>
  (block.header?.length ?? 0) <= 2 &&
  block.rows.every((row) => row.length <= 2);

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/\*\*/g, "")
    .trim();

const stripBold = (value: string) => value.replace(/\*\*/g, "").trim();

/** "**Hvl** (HVL)" -> "Hvl" (tên khóa, bỏ mã trong ngoặc). */
const parseCourseItem = (item: string) => {
  const bold = item.match(/\*\*([^*]+)\*\*/);
  const raw = bold ? bold[1] : item.replace(/\([^)]*\)/g, "");
  return raw.trim();
};

/**
 * Gộp 2 mục "Các khóa học đang tham gia" (list) + "Các lớp đang học" (bảng có
 * cột Lớp/Khóa) thành MỘT mục duy nhất: mỗi khóa 1 dòng kèm các lớp của nó —
 * gọn hơn hẳn vì thông tin khóa vốn bị lặp ở cả 2 mục. Không khớp cấu trúc thì
 * giữ nguyên như cũ.
 */
function mergeCourseAndClassSections(blocks: Block[]): Block[] {
  const tableIndex = blocks.findIndex(
    (block) =>
      block.kind === "table" &&
      block.header !== null &&
      block.header.some((cell) => normalizeKey(cell) === "lop") &&
      block.header.some((cell) => normalizeKey(cell) === "khoa"),
  );
  if (tableIndex < 0) return blocks;
  const table = blocks[tableIndex] as Extract<Block, { kind: "table" }>;
  const header = table.header as string[];
  const lopIdx = header.findIndex((cell) => normalizeKey(cell) === "lop");
  const khoaIdx = header.findIndex((cell) => normalizeKey(cell) === "khoa");
  const loaiIdx = header.findIndex((cell) =>
    ["loai", "type", "loai lop"].includes(normalizeKey(cell)),
  );

  const dropped = new Set<number>([tableIndex]);

  // Heading đứng ngay trên bảng lớp ("🏫 Các lớp đang học (4 lớp):").
  const tableHeading = blocks[tableIndex - 1];
  if (
    tableHeading?.kind === "paragraph" &&
    normalizeKey(tableHeading.lines.join(" ")).includes("lop")
  ) {
    dropped.add(tableIndex - 1);
  }

  // Mục danh sách khóa: list mà heading ngay trên nhắc tới "khóa học".
  let courseListIndex = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind !== "list") continue;
    const heading = blocks[i - 1];
    if (
      heading?.kind === "paragraph" &&
      normalizeKey(heading.lines.join(" ")).includes("khoa hoc")
    ) {
      courseListIndex = i;
      dropped.add(i);
      dropped.add(i - 1);
      break;
    }
  }

  // Nhóm lớp theo khóa (giữ thứ tự xuất hiện trong bảng).
  const groups: Array<{
    course: string;
    classes: Array<{ name: string; type: string | null }>;
  }> = [];
  const groupByKey = new Map<string, (typeof groups)[number]>();
  for (const row of table.rows) {
    const course = stripBold(row[khoaIdx] || "") || "Khóa khác";
    const key = normalizeKey(course);
    let group = groupByKey.get(key);
    if (!group) {
      group = { course, classes: [] };
      groupByKey.set(key, group);
      groups.push(group);
    }
    group.classes.push({
      name: stripBold(row[lopIdx] || "") || `#${group.classes.length + 1}`,
      type: loaiIdx >= 0 ? stripBold(row[loaiIdx] || "") || null : null,
    });
  }

  // Khóa có trong danh sách nhưng chưa có lớp nào trong bảng -> vẫn hiện.
  if (courseListIndex >= 0) {
    const list = blocks[courseListIndex] as Extract<Block, { kind: "list" }>;
    for (const item of list.items) {
      const course = parseCourseItem(item);
      if (!course) continue;
      const key = normalizeKey(course);
      if (!groupByKey.has(key)) {
        const group = { course, classes: [] };
        groupByKey.set(key, group);
        groups.push(group);
      }
    }
  }

  if (!groups.length) return blocks;

  const merged: Block = {
    kind: "courseClasses",
    groups,
    classCount: table.rows.length,
  };
  const insertAt = Math.min(...dropped);
  const result: Block[] = [];
  blocks.forEach((block, index) => {
    if (index === insertAt) result.push(merged);
    if (!dropped.has(index)) result.push(block);
  });
  return result;
}

function KeyValueRows({
  block,
  blockIndex,
}: {
  block: Extract<Block, { kind: "table" }>;
  blockIndex: number;
}) {
  return (
    <dl className="divide-y divide-zinc-100">
      {block.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-3 py-1.5">
          <dt className="w-28 shrink-0 text-xs leading-5 text-zinc-500">
            {renderInline(
              row[0]?.replace(/\*\*/g, "") || "",
              `${blockIndex}-${rowIndex}-k`,
            )}
          </dt>
          <dd className="min-w-0 flex-1 break-words text-[13px] leading-5 text-zinc-800">
            {row[1]?.trim() && row[1] !== "(trống)" ? (
              renderInline(row[1], `${blockIndex}-${rowIndex}-v`)
            ) : (
              <span className="text-zinc-400">Chưa cập nhật</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DataTable({
  block,
  blockIndex,
}: {
  block: Extract<Block, { kind: "table" }>;
  blockIndex: number;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      {block.header && (
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/80">
            {block.header.map((cell, cellIndex) => (
              <th
                key={cellIndex}
                className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                {renderInline(
                  cell.replace(/\*\*/g, ""),
                  `${blockIndex}-h${cellIndex}`,
                )}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody className="divide-y divide-zinc-100">
        {block.rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="bg-white">
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className="px-4 py-2 align-top leading-5 text-zinc-800"
              >
                {renderInline(cell, `${blockIndex}-${rowIndex}-${cellIndex}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BulletList({
  block,
  blockIndex,
}: {
  block: Extract<Block, { kind: "list" }>;
  blockIndex: number;
}) {
  return (
    <ul className="space-y-1">
      {block.items.map((item, itemIndex) => (
        <li key={itemIndex} className="flex gap-2">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
          <span className="min-w-0 flex-1">
            {renderInline(item, `${blockIndex}-${itemIndex}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CourseClassesSection({
  block,
  onSelect,
}: {
  block: Extract<Block, { kind: "courseClasses" }>;
  onSelect?: (msg: string) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-900">
        Khóa học & lớp đang học{" "}
        <span className="font-normal text-zinc-400">
          ({block.groups.length} khóa · {block.classCount} lớp)
        </span>
      </p>
      <dl className="mt-1 divide-y divide-zinc-100">
        {block.groups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex gap-3 py-1.5">
            <dt className="w-28 shrink-0 break-words text-xs font-medium leading-5 text-zinc-600">
              <button
                type="button"
                disabled={!onSelect}
                onClick={() =>
                  onSelect?.(`Xem chi tiết khóa ${group.course}`)
                }
                className="text-left enabled:cursor-pointer enabled:underline-offset-2 enabled:hover:text-indigo-600 enabled:hover:underline"
              >
                {group.course}
              </button>
            </dt>
            <dd className="min-w-0 flex-1 break-words text-[13px] leading-5 text-zinc-800">
              {group.classes.length ? (
                group.classes.map((cls, classIndex) => (
                  <React.Fragment key={classIndex}>
                    {classIndex > 0 && ", "}
                    <button
                      type="button"
                      disabled={!onSelect}
                      onClick={() =>
                        onSelect?.(`Xem chi tiết lớp ${cls.name}`)
                      }
                      className="text-left enabled:cursor-pointer enabled:underline-offset-2 enabled:hover:text-indigo-600 enabled:hover:underline"
                    >
                      {cls.name}
                    </button>
                    {cls.type && (
                      <span className="text-zinc-400"> ({cls.type})</span>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <span className="text-zinc-400">Chưa vào lớp nào</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Paragraph({
  block,
  blockIndex,
  asHeading,
}: {
  block: Extract<Block, { kind: "paragraph" }>;
  blockIndex: number;
  asHeading?: boolean;
}) {
  return (
    <p
      className={
        asHeading
          ? "whitespace-pre-wrap break-words text-sm font-medium text-zinc-900"
          : "whitespace-pre-wrap break-words"
      }
    >
      {block.lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {renderInline(line, `${blockIndex}-${lineIndex}`)}
        </React.Fragment>
      ))}
    </p>
  );
}

export default function MarkdownMessage({
  content,
  onSelect,
}: {
  content: string;
  /** Click tên khóa/lớp trong card -> xem chi tiết (gửi draft qua chat). */
  onSelect?: (msg: string) => void;
}) {
  const blocks = mergeCourseAndClassSections(parseBlocks(content));
  const isRich = blocks.some(
    (block) => block.kind === "table" || block.kind === "courseClasses",
  );

  // Nội dung thuần văn bản/danh sách -> tin nhắn thường, không đóng khung.
  if (!isRich) {
    return (
      <div className="space-y-2.5 text-sm leading-6 text-zinc-800">
        {blocks.map((block, blockIndex) =>
          block.kind === "list" ? (
            <BulletList key={blockIndex} block={block} blockIndex={blockIndex} />
          ) : block.kind === "paragraph" ? (
            <Paragraph key={blockIndex} block={block} blockIndex={blockIndex} />
          ) : null,
        )}
      </div>
    );
  }

  // Nội dung "hồ sơ" (có bảng) -> gom TẤT CẢ vào 1 card duy nhất; các phần
  // ngăn nhau bằng đường kẻ mảnh, bảng nhiều cột tràn hết chiều ngang card.
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white text-sm leading-6 text-zinc-800">
      <div className="divide-y divide-zinc-100">
        {blocks.map((block, blockIndex) => {
          if (block.kind === "courseClasses") {
            return (
              <div key={blockIndex} className="px-4 py-2.5">
                <CourseClassesSection block={block} onSelect={onSelect} />
              </div>
            );
          }
          if (block.kind === "table") {
            if (isKeyValueTable(block)) {
              return (
                <div key={blockIndex} className="px-4 py-2">
                  <KeyValueRows block={block} blockIndex={blockIndex} />
                </div>
              );
            }
            return (
              <div key={blockIndex} className="overflow-x-auto">
                <DataTable block={block} blockIndex={blockIndex} />
              </div>
            );
          }
          if (block.kind === "list") {
            return (
              <div key={blockIndex} className="px-4 py-2.5">
                <BulletList block={block} blockIndex={blockIndex} />
              </div>
            );
          }
          return (
            <div key={blockIndex} className="px-4 py-2.5">
              <Paragraph
                block={block}
                blockIndex={blockIndex}
                asHeading={blockIndex === 0}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
