import {
  AGENT_TOOLS,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  isReadTool,
  isWriteTool,
} from './tool-definitions';

describe('tool-definitions', () => {
  it('không có tool schema nào chứa additionalProperties', () => {
    expect(JSON.stringify(AGENT_TOOLS)).not.toContain('additionalProperties');
  });

  it('READ_TOOL_NAMES và WRITE_TOOL_NAMES không có phần tử trùng nhau', () => {
    const overlap = READ_TOOL_NAMES.filter((name) =>
      WRITE_TOOL_NAMES.includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it('isReadTool và isWriteTool trả đúng cho mọi tool trong danh sách', () => {
    for (const name of READ_TOOL_NAMES) {
      expect(isReadTool(name)).toBe(true);
      expect(isWriteTool(name)).toBe(false);
    }

    for (const name of WRITE_TOOL_NAMES) {
      expect(isWriteTool(name)).toBe(true);
      expect(isReadTool(name)).toBe(false);
    }
  });

  it('ask_clarification không nằm trong READ_TOOL_NAMES hay WRITE_TOOL_NAMES', () => {
    expect(READ_TOOL_NAMES).not.toContain('ask_clarification');
    expect(WRITE_TOOL_NAMES).not.toContain('ask_clarification');
    expect(isReadTool('ask_clarification')).toBe(false);
    expect(isWriteTool('ask_clarification')).toBe(false);
  });

  it('mọi tool đều có description không rỗng', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.function.description.trim().length).toBeGreaterThan(0);
    }
  });
});
