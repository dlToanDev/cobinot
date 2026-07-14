import {
  FULL_AGENT_TOOLS,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  getConfiguredAgentTools,
  isReadTool,
  isWriteTool,
} from './tool-definitions';

describe('tool-definitions', () => {
  it('không có tool schema nào chứa additionalProperties', () => {
    expect(JSON.stringify(FULL_AGENT_TOOLS)).not.toContain(
      'additionalProperties',
    );
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

  it('assign_student_to_course là WRITE tool, không phải READ tool', () => {
    expect(WRITE_TOOL_NAMES).toContain('assign_student_to_course');
    expect(READ_TOOL_NAMES).not.toContain('assign_student_to_course');
    expect(isWriteTool('assign_student_to_course')).toBe(true);
    expect(isReadTool('assign_student_to_course')).toBe(false);
    expect(
      FULL_AGENT_TOOLS.some(
        (tool) => tool.function.name === 'assign_student_to_course',
      ),
    ).toBe(true);
  });

  it('create_course KHÔNG có startDate/expireDate trong schema (ngày chỉ thuộc lớp), title bắt buộc', () => {
    const tool = FULL_AGENT_TOOLS.find(
      (item) => item.function.name === 'create_course',
    );
    expect(tool).toBeDefined();
    const props = tool!.function.parameters.properties;
    expect(props).not.toHaveProperty('startDate');
    expect(props).not.toHaveProperty('expireDate');
    expect(tool!.function.parameters.required).toContain('title');
  });

  it('create_class là WRITE tool và schema không nhận field sai DB', () => {
    expect(WRITE_TOOL_NAMES).toContain('create_class');
    expect(READ_TOOL_NAMES).not.toContain('create_class');
    expect(isWriteTool('create_class')).toBe(true);
    expect(isReadTool('create_class')).toBe(false);

    const tool = FULL_AGENT_TOOLS.find(
      (item) => item.function.name === 'create_class',
    );
    expect(tool).toBeDefined();
    const props = tool!.function.parameters.properties;

    expect(props).toHaveProperty('courseId');
    expect(props).toHaveProperty('title');
    expect(props).toHaveProperty('type');
    expect(props).toHaveProperty('sessions');
    expect(props).not.toHaveProperty('classCode');
    expect(props).not.toHaveProperty('classType');
    expect(props).not.toHaveProperty('capacity');
    expect(props).not.toHaveProperty('teacherId');
    expect(props).not.toHaveProperty('room');
    expect(props).not.toHaveProperty('scheduleText');
    expect(tool!.function.parameters.required).toEqual(['courseId', 'title']);
  });

  it('mọi tool đều có description không rỗng', () => {
    for (const tool of FULL_AGENT_TOOLS) {
      expect(tool.function.description.trim().length).toBeGreaterThan(0);
    }
  });

  describe('mini mode tools', () => {
    const originalEnv = process.env.AGENT_MINI_MODE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AGENT_MINI_MODE;
      } else {
        process.env.AGENT_MINI_MODE = originalEnv;
      }
    });

    it('mini mode expose đúng tool cho 7 nghiệp vụ (tạo/sửa + ghi danh theo LỚP)', () => {
      process.env.AGENT_MINI_MODE = 'true';
      const names = getConfiguredAgentTools().map((t) => t.function.name);

      // WRITE: tạo học viên, tạo khóa, tạo lớp, thêm học viên vào lớp.
      expect(names).toContain('create_student');
      expect(names).toContain('create_course');
      expect(names).toContain('create_class');
      expect(names).toContain('assign_student_to_class');
      // WRITE: sửa thông tin học viên/khóa học/lớp học.
      expect(names).toContain('update_student');
      expect(names).toContain('update_course');
      expect(names).toContain('update_class');
      // READ hỗ trợ.
      expect(names).toContain('search_student');
      expect(names).toContain('get_student_detail');
      expect(names).toContain('search_course');
      expect(names).toContain('get_course_detail');
      expect(names).toContain('get_course_classes');
      expect(names).toContain('search_class');
      expect(names).toContain('get_class_detail');
      expect(names).toContain('ask_clarification');

      // Ghi danh cấp khóa KHÔNG expose (flow chính là vào lớp).
      expect(names).not.toContain('assign_student_to_course');
      // Ngoài phạm vi mini: xóa/đóng/gỡ.
      expect(names).not.toContain('delete_students');
      expect(names).not.toContain('delete_courses');
      expect(names).not.toContain('close_class');
      expect(names).not.toContain('remove_student_from_class');
      expect(names).not.toContain('remove_student_from_course_classes');
    });

    it('expose full tool khi AGENT_MINI_MODE=false', () => {
      process.env.AGENT_MINI_MODE = 'false';
      const names = getConfiguredAgentTools().map((t) => t.function.name);

      expect(names).toContain('update_student');
      expect(names).toContain('delete_students');
      expect(names).toContain('close_class');
    });
  });
});
