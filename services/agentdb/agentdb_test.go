package agentdb

import (
	"context"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Unit Tests for Helper Functions
// ---------------------------------------------------------------------------

func TestStringProp(t *testing.T) {
	tests := []struct {
		name     string
		props    map[string]any
		key      string
		expected string
	}{
		{
			name:     "returns string value",
			props:    map[string]any{"name": "test-agent"},
			key:      "name",
			expected: "test-agent",
		},
		{
			name:     "returns empty for missing key",
			props:    map[string]any{"name": "test-agent"},
			key:      "missing",
			expected: "",
		},
		{
			name:     "returns empty for non-string value",
			props:    map[string]any{"count": 42},
			key:      "count",
			expected: "",
		},
		{
			name:     "returns empty for nil props",
			props:    map[string]any{},
			key:      "name",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stringProp(tt.props, tt.key)
			if result != tt.expected {
				t.Errorf("stringProp() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestBoolProp(t *testing.T) {
	tests := []struct {
		name     string
		props    map[string]any
		key      string
		expected bool
	}{
		{
			name:     "returns true",
			props:    map[string]any{"active": true},
			key:      "active",
			expected: true,
		},
		{
			name:     "returns false",
			props:    map[string]any{"active": false},
			key:      "active",
			expected: false,
		},
		{
			name:     "returns false for missing key",
			props:    map[string]any{},
			key:      "active",
			expected: false,
		},
		{
			name:     "returns false for non-bool value",
			props:    map[string]any{"active": "yes"},
			key:      "active",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := boolProp(tt.props, tt.key)
			if result != tt.expected {
				t.Errorf("boolProp() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestInt64Prop(t *testing.T) {
	tests := []struct {
		name     string
		props    map[string]any
		key      string
		expected int64
	}{
		{
			name:     "returns int64 value",
			props:    map[string]any{"count": int64(42)},
			key:      "count",
			expected: 42,
		},
		{
			name:     "returns 0 for missing key",
			props:    map[string]any{},
			key:      "count",
			expected: 0,
		},
		{
			name:     "returns 0 for non-int64 value",
			props:    map[string]any{"count": "42"},
			key:      "count",
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := int64Prop(tt.props, tt.key)
			if result != tt.expected {
				t.Errorf("int64Prop() = %d, want %d", result, tt.expected)
			}
		})
	}
}

func TestJoinConditions(t *testing.T) {
	tests := []struct {
		name       string
		conditions []string
		separator  string
		expected   string
	}{
		{
			name:       "single condition",
			conditions: []string{"a.type = $type"},
			separator:  " AND ",
			expected:   "a.type = $type",
		},
		{
			name:       "multiple conditions",
			conditions: []string{"a.type = $type", "a.active = $active"},
			separator:  " AND ",
			expected:   "a.type = $type AND a.active = $active",
		},
		{
			name:       "empty conditions",
			conditions: []string{},
			separator:  " AND ",
			expected:   "",
		},
		{
			name:       "comma separator",
			conditions: []string{"a.name = $name", "a.updated_at = $updated_at"},
			separator:  ", ",
			expected:   "a.name = $name, a.updated_at = $updated_at",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := joinConditions(tt.conditions, tt.separator)
			if result != tt.expected {
				t.Errorf("joinConditions() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Unit Tests for Data Structures
// ---------------------------------------------------------------------------

func TestAgentStruct(t *testing.T) {
	agent := Agent{
		ID:          "agent-001",
		Name:        "Topic Assistant",
		Description: "An AI agent that helps with topic exploration",
		Type:        "topic-assistant",
		Config:      map[string]string{"model": "gpt-4", "temperature": "0.7"},
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
		Active:      true,
	}

	if agent.ID != "agent-001" {
		t.Errorf("Agent.ID = %q, want %q", agent.ID, "agent-001")
	}
	if agent.Name != "Topic Assistant" {
		t.Errorf("Agent.Name = %q, want %q", agent.Name, "Topic Assistant")
	}
	if agent.Type != "topic-assistant" {
		t.Errorf("Agent.Type = %q, want %q", agent.Type, "topic-assistant")
	}
	if !agent.Active {
		t.Error("Agent.Active = false, want true")
	}
	if agent.Config["model"] != "gpt-4" {
		t.Errorf("Agent.Config[model] = %q, want %q", agent.Config["model"], "gpt-4")
	}
}

func TestConversationStruct(t *testing.T) {
	conv := Conversation{
		ID:        "conv-001",
		AgentID:   "agent-001",
		UserID:    "user-123",
		Title:     "Topic Analysis Session",
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if conv.ID != "conv-001" {
		t.Errorf("Conversation.ID = %q, want %q", conv.ID, "conv-001")
	}
	if conv.AgentID != "agent-001" {
		t.Errorf("Conversation.AgentID = %q, want %q", conv.AgentID, "agent-001")
	}
	if conv.UserID != "user-123" {
		t.Errorf("Conversation.UserID = %q, want %q", conv.UserID, "user-123")
	}
}

func TestMessageStruct(t *testing.T) {
	msg := Message{
		ID:             "msg-001",
		ConversationID: "conv-001",
		Role:           "user",
		Content:        "What are the trending AI topics today?",
		Timestamp:      time.Now().UTC(),
		TokenCount:     10,
	}

	if msg.ID != "msg-001" {
		t.Errorf("Message.ID = %q, want %q", msg.ID, "msg-001")
	}
	if msg.Role != "user" {
		t.Errorf("Message.Role = %q, want %q", msg.Role, "user")
	}
	if msg.TokenCount != 10 {
		t.Errorf("Message.TokenCount = %d, want %d", msg.TokenCount, 10)
	}
}

// ---------------------------------------------------------------------------
// Unit Tests for AgentFilter
// ---------------------------------------------------------------------------

func TestAgentFilter(t *testing.T) {
	active := true
	filter := AgentFilter{
		Type:   "topic-assistant",
		Active: &active,
		Limit:  10,
		Offset: 0,
	}

	if filter.Type != "topic-assistant" {
		t.Errorf("AgentFilter.Type = %q, want %q", filter.Type, "topic-assistant")
	}
	if filter.Active == nil || !*filter.Active {
		t.Error("AgentFilter.Active should be true")
	}
	if filter.Limit != 10 {
		t.Errorf("AgentFilter.Limit = %d, want %d", filter.Limit, 10)
	}
}

// ---------------------------------------------------------------------------
// Unit Tests for Config
// ---------------------------------------------------------------------------

func TestConfig(t *testing.T) {
	cfg := Config{
		URI:      "bolt://localhost:7687",
		Username: "neo4j",
		Password: "password",
		Database: "neo4j",
	}

	if cfg.URI != "bolt://localhost:7687" {
		t.Errorf("Config.URI = %q, want %q", cfg.URI, "bolt://localhost:7687")
	}
	if cfg.Username != "neo4j" {
		t.Errorf("Config.Username = %q, want %q", cfg.Username, "neo4j")
	}
	if cfg.Database != "neo4j" {
		t.Errorf("Config.Database = %q, want %q", cfg.Database, "neo4j")
	}
}

// ---------------------------------------------------------------------------
// Integration Test Helpers (require running Neo4j instance)
// ---------------------------------------------------------------------------

// testService creates a test service connection.
// Skip tests if Neo4j is not available.
func testService(t *testing.T) *Service {
	t.Helper()

	cfg := Config{
		URI:      "bolt://localhost:7687",
		Username: "neo4j",
		Password: "password",
		Database: "neo4j",
	}

	svc, err := NewService(cfg)
	if err != nil {
		t.Skipf("Skipping integration test: cannot create service: %v", err)
	}

	ctx := context.Background()
	if err := svc.Ping(ctx); err != nil {
		svc.Close(ctx)
		t.Skipf("Skipping integration test: Neo4j not available: %v", err)
	}

	return svc
}

func TestServicePing_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()
	if err := svc.Ping(ctx); err != nil {
		t.Errorf("Ping() failed: %v", err)
	}
}

func TestCreateAndGetAgent_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()

	agent := &Agent{
		ID:          "test-agent-001",
		Name:        "Test Agent",
		Description: "A test agent for integration tests",
		Type:        "test",
		Config:      map[string]string{"env": "test"},
		Active:      true,
	}

	// Clean up before and after
	_ = svc.DeleteAgent(ctx, agent.ID)
	defer svc.DeleteAgent(ctx, agent.ID)

	// Create
	if err := svc.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("CreateAgent() failed: %v", err)
	}

	// Verify timestamps were set
	if agent.CreatedAt.IsZero() {
		t.Error("CreateAgent() did not set CreatedAt")
	}
	if agent.UpdatedAt.IsZero() {
		t.Error("CreateAgent() did not set UpdatedAt")
	}

	// Get
	retrieved, err := svc.GetAgent(ctx, agent.ID)
	if err != nil {
		t.Fatalf("GetAgent() failed: %v", err)
	}

	if retrieved.ID != agent.ID {
		t.Errorf("GetAgent().ID = %q, want %q", retrieved.ID, agent.ID)
	}
	if retrieved.Name != agent.Name {
		t.Errorf("GetAgent().Name = %q, want %q", retrieved.Name, agent.Name)
	}
	if retrieved.Type != agent.Type {
		t.Errorf("GetAgent().Type = %q, want %q", retrieved.Type, agent.Type)
	}
}

func TestListAgents_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()

	// Create a test agent
	agent := &Agent{
		ID:     "test-list-agent-001",
		Name:   "List Test Agent",
		Type:   "test-list",
		Active: true,
	}

	_ = svc.CreateAgent(ctx, agent)
	defer svc.DeleteAgent(ctx, agent.ID)

	// List all
	agents, err := svc.ListAgents(ctx, AgentFilter{Limit: 100})
	if err != nil {
		t.Fatalf("ListAgents() failed: %v", err)
	}

	if len(agents) == 0 {
		t.Error("ListAgents() returned empty list")
	}

	// List with type filter
	filtered, err := svc.ListAgents(ctx, AgentFilter{Type: "test-list", Limit: 10})
	if err != nil {
		t.Fatalf("ListAgents() with filter failed: %v", err)
	}

	found := false
	for _, a := range filtered {
		if a.ID == agent.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("ListAgents() with type filter did not return test agent")
	}
}

func TestUpdateAgent_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()

	agent := &Agent{
		ID:     "test-update-agent-001",
		Name:   "Update Test Agent",
		Type:   "test",
		Active: true,
	}

	_ = svc.CreateAgent(ctx, agent)
	defer svc.DeleteAgent(ctx, agent.ID)

	// Update
	updates := map[string]any{
		"name":        "Updated Agent Name",
		"description": "Updated description",
	}
	if err := svc.UpdateAgent(ctx, agent.ID, updates); err != nil {
		t.Fatalf("UpdateAgent() failed: %v", err)
	}

	// Verify
	retrieved, err := svc.GetAgent(ctx, agent.ID)
	if err != nil {
		t.Fatalf("GetAgent() after update failed: %v", err)
	}

	if retrieved.Name != "Updated Agent Name" {
		t.Errorf("UpdateAgent() name = %q, want %q", retrieved.Name, "Updated Agent Name")
	}
	if retrieved.Description != "Updated description" {
		t.Errorf("UpdateAgent() description = %q, want %q", retrieved.Description, "Updated description")
	}
}

func TestDeleteAgent_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()

	agent := &Agent{
		ID:     "test-delete-agent-001",
		Name:   "Delete Test Agent",
		Type:   "test",
		Active: true,
	}

	_ = svc.CreateAgent(ctx, agent)

	// Delete
	if err := svc.DeleteAgent(ctx, agent.ID); err != nil {
		t.Fatalf("DeleteAgent() failed: %v", err)
	}

	// Verify deleted
	_, err := svc.GetAgent(ctx, agent.ID)
	if err == nil {
		t.Error("GetAgent() should fail after DeleteAgent()")
	}
}

func TestConversationCRUD_Integration(t *testing.T) {
	svc := testService(t)
	defer svc.Close(context.Background())

	ctx := context.Background()

	agent := &Agent{
		ID:     "test-conv-agent-001",
		Name:   "Conversation Test Agent",
		Type:   "test",
		Active: true,
	}

	_ = svc.CreateAgent(ctx, agent)
	defer svc.DeleteAgent(ctx, agent.ID)

	// Create conversation
	conv := &Conversation{
		ID:      "test-conv-001",
		AgentID: agent.ID,
		UserID:  "test-user",
		Title:   "Test Conversation",
	}

	if err := svc.CreateConversation(ctx, conv); err != nil {
		t.Fatalf("CreateConversation() failed: %v", err)
	}

	// Get conversations
	convs, err := svc.GetConversations(ctx, agent.ID, 10)
	if err != nil {
		t.Fatalf("GetConversations() failed: %v", err)
	}

	if len(convs) == 0 {
		t.Error("GetConversations() returned empty list")
	}

	// Add messages
	msg1 := &Message{
		ID:             "test-msg-001",
		ConversationID: conv.ID,
		Role:           "user",
		Content:        "Hello, agent!",
		TokenCount:     3,
	}
	msg2 := &Message{
		ID:             "test-msg-002",
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        "Hello! How can I help you today?",
		TokenCount:     8,
	}

	if err := svc.AddMessage(ctx, msg1); err != nil {
		t.Fatalf("AddMessage() failed: %v", err)
	}
	if err := svc.AddMessage(ctx, msg2); err != nil {
		t.Fatalf("AddMessage() failed: %v", err)
	}

	// Get messages
	msgs, err := svc.GetMessages(ctx, conv.ID, 10)
	if err != nil {
		t.Fatalf("GetMessages() failed: %v", err)
	}

	if len(msgs) != 2 {
		t.Errorf("GetMessages() returned %d messages, want 2", len(msgs))
	}

	// Verify chronological order
	if len(msgs) >= 2 {
		if msgs[0].Role != "user" {
			t.Errorf("First message role = %q, want %q", msgs[0].Role, "user")
		}
		if msgs[1].Role != "assistant" {
			t.Errorf("Second message role = %q, want %q", msgs[1].Role, "assistant")
		}
	}
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

func BenchmarkStringProp(b *testing.B) {
	props := map[string]any{"name": "test-agent", "type": "topic-assistant"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		stringProp(props, "name")
	}
}

func BenchmarkJoinConditions(b *testing.B) {
	conditions := []string{"a.type = $type", "a.active = $active", "a.name = $name"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		joinConditions(conditions, " AND ")
	}
}
