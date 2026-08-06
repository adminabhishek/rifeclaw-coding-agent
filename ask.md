# Ask Mode

## Question

what is inside the /modes/agent explain me what is going on into proper example code

## Answer

The `/modes/agent` directory contains core components of an AI agent management system that handles workflow, approvals, and codebase operations. Here's a breakdown of its structure and functionality:

---

### **Key Components**
1. **Action Tracking System** (`action-tracker.ts`)
   - **Purpose**: Tracks file changes and commands with approval workflows
   - **Key Features**:
     - Records actions (file modifications, creations, deletions, folder creations, and shell commands)
     - Supports status tracking (`pending`, `approved`, `rejected`, `executed`)
     - Provides pending mutation inspection
   ```typescript
   // Example: Pending mutations can be filtered and managed
   const pendingMutations = tracker.getPendingMutations();
   ```

2. **Agent Tools** (`agent-tools.ts`)
   - **Purpose**: Provides safe tooling operations for file/directory manipulation
   - **Operations**:
     - Read/write files (modify/create/delete)
     - Create folders
     - Execute shell commands
     - Codebase analysis
   ```typescript
   // Example: Read a file using staged tooling
   const content = await agentTools.read_file({ path: "some_file.txt" });
   ```

3. **Approval Workflow** (`approval.ts`)
   - **Purpose**: Implements user approval process for changes
   - **Flow**:
     1. Lists pending changes grouped by path/type
     2. Offers batch approval (accept all) or individual reviews
     3. Shows diffs and allows interactive approval
   ```typescript
   // Apply staged changes with prompts
   const applied = await runApprovalFlow(tracker);
   ```

---

### **Example Workflow**
1. **Stage Changes** (`action-tracker`):
   ```typescript
   // Log a file modification
   tracker.log({
     type: "file_modify",
     path: "src/index.ts",
     details: { before: "old code", after: "new code" },
     status: "pending",
   });
   ```

2. **Review Pending Changes**:
   ```javascript
   // List pending changes in batches
   const groups = groupPending(pending);
   // Use CLI prompts to approve/reject changes
   const result = await runApprovalFlow(tracker);
   ```

3. **Execute Actions**:
   ```typescript
   // Apply approved changes through executor
   executor.applyApproval(result.approvedActions);
   ```

---

### **Tool Configuration** (`types.ts`)
```typescript
interface AgentConfig {
  tools: {
    allowFileCreation: boolean; // Enable/disable file creation
    allowShellExecution: boolean; // Enable/disable shell commands
  };
}
```

---

### **Integration**
This system integrates with your project through:
- **Read SKILLS**: Uses `list_skills` and `read_skill` to fetch prompt configurations
- **File Operations**: Interacts with your workspace using `list_files` and `read_file`
- **Code Analysis**: Provides statistics through `analyze_codebase`

The full workflow enables safe, approved modifications to your codebase while maintaining audit trails through detailed action logging.
