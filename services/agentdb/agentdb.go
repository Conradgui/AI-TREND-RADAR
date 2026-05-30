// Package agentdb provides database operations for AI agent management.
// It wraps Neo4j graph database interactions for storing and retrieving
// agent configurations, conversation history, and knowledge graph data.
package agentdb

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// Agent represents an AI agent entity stored in the graph database.
type Agent struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Type        string            `json:"type"` // e.g., "topic-assistant", "content-generator"
	Config      map[string]string `json:"config"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	Active      bool              `json:"active"`
}

// Conversation represents a conversation session with an agent.
type Conversation struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agent_id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Message represents a single message in a conversation.
type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Role           string    `json:"role"` // "user", "assistant", "system"
	Content        string    `json:"content"`
	Timestamp      time.Time `json:"timestamp"`
	TokenCount     int       `json:"token_count"`
}

// AgentFilter provides filtering options for agent queries.
type AgentFilter struct {
	Type   string
	Active *bool
	Limit  int
	Offset int
}

// Config holds the database connection configuration.
type Config struct {
	URI      string `yaml:"uri"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	Database string `yaml:"database"`
}

// Service provides database operations for agent management.
type Service struct {
	driver   neo4j.DriverWithContext
	database string
}

// NewService creates a new AgentDBService with the given configuration.
// It establishes a connection to the Neo4j database and verifies connectivity.
func NewService(cfg Config) (*Service, error) {
	if cfg.URI == "" {
		cfg.URI = "bolt://localhost:7687"
	}
	if cfg.Database == "" {
		cfg.Database = "neo4j"
	}

	driver, err := neo4j.NewDriverWithContext(
		cfg.URI,
		neo4j.BasicAuth(cfg.Username, cfg.Password, ""),
	)
	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to create driver: %w", err)
	}

	return &Service{
		driver:   driver,
		database: cfg.Database,
	}, nil
}

// NewServiceWithDriver creates a service with an existing driver (useful for testing).
func NewServiceWithDriver(driver neo4j.DriverWithContext, database string) *Service {
	if database == "" {
		database = "neo4j"
	}
	return &Service{
		driver:   driver,
		database: database,
	}
}

// Ping verifies the database connection is healthy.
func (s *Service) Ping(ctx context.Context) error {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err := session.Run(ctx, "RETURN 1 AS ping", nil)
	if err != nil {
		return fmt.Errorf("agentdb: ping failed: %w", err)
	}
	return nil
}

// Close closes the database driver connection.
func (s *Service) Close(ctx context.Context) error {
	if s.driver != nil {
		return s.driver.Close(ctx)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Agent CRUD Operations
// ---------------------------------------------------------------------------

// CreateAgent persists a new agent to the graph database.
func (s *Service) CreateAgent(ctx context.Context, agent *Agent) error {
	if agent.ID == "" {
		return fmt.Errorf("agentdb: agent ID is required")
	}
	if agent.Name == "" {
		return fmt.Errorf("agentdb: agent name is required")
	}

	now := time.Now().UTC()
	agent.CreatedAt = now
	agent.UpdatedAt = now

	configJSON, err := json.Marshal(agent.Config)
	if err != nil {
		return fmt.Errorf("agentdb: failed to marshal config: %w", err)
	}

	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err = session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MERGE (a:Agent {id: $id})
			SET a.name = $name,
			    a.description = $description,
			    a.type = $type,
			    a.config = $config,
			    a.created_at = datetime($created_at),
			    a.updated_at = datetime($updated_at),
			    a.active = $active
			RETURN a.id
		`
		params := map[string]any{
			"id":          agent.ID,
			"name":        agent.Name,
			"description": agent.Description,
			"type":        agent.Type,
			"config":      string(configJSON),
			"created_at":  agent.CreatedAt.Format(time.RFC3339),
			"updated_at":  agent.UpdatedAt.Format(time.RFC3339),
			"active":      agent.Active,
		}
		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}
		return result.Single(ctx)
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to create agent %s: %w", agent.ID, err)
	}
	return nil
}

// GetAgent retrieves an agent by its unique ID.
func (s *Service) GetAgent(ctx context.Context, id string) (*Agent, error) {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `MATCH (a:Agent {id: $id}) RETURN a LIMIT 1`
		result, err := tx.Run(ctx, query, map[string]any{"id": id})
		if err != nil {
			return nil, err
		}

		record, err := result.Single(ctx)
		if err != nil {
			return nil, err
		}

		node, ok := record.Get("a")
		if !ok {
			return nil, fmt.Errorf("agentdb: no agent node returned")
		}

		return nodeToAgent(node.(neo4j.Node))
	})

	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to get agent %s: %w", id, err)
	}

	return result.(*Agent), nil
}

// ListAgents retrieves agents matching the given filter criteria.
func (s *Service) ListAgents(ctx context.Context, filter AgentFilter) ([]*Agent, error) {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `MATCH (a:Agent)`
		params := map[string]any{}

		conditions := []string{}
		if filter.Type != "" {
			conditions = append(conditions, "a.type = $type")
			params["type"] = filter.Type
		}
		if filter.Active != nil {
			conditions = append(conditions, "a.active = $active")
			params["active"] = *filter.Active
		}

		if len(conditions) > 0 {
			query += " WHERE " + joinConditions(conditions, " AND ")
		}

		query += " RETURN a ORDER BY a.created_at DESC"

		if filter.Limit > 0 {
			query += " LIMIT $limit"
			params["limit"] = int64(filter.Limit)
		}
		if filter.Offset > 0 {
			query += " SKIP $offset"
			params["offset"] = int64(filter.Offset)
		}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		agents := []*Agent{}
		for result.Next(ctx) {
			record := result.Record()
			node, ok := record.Get("a")
			if !ok {
				continue
			}
			agent, err := nodeToAgent(node.(neo4j.Node))
			if err != nil {
				return nil, err
			}
			agents = append(agents, agent)
		}
		return agents, result.Err()
	})

	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to list agents: %w", err)
	}

	return result.([]*Agent), nil
}

// UpdateAgent updates an existing agent's mutable fields.
func (s *Service) UpdateAgent(ctx context.Context, id string, updates map[string]any) error {
	if len(updates) == 0 {
		return fmt.Errorf("agentdb: no updates provided")
	}

	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		setClauses := []string{"a.updated_at = datetime($updated_at)"}
		params := map[string]any{
			"id":         id,
			"updated_at": time.Now().UTC().Format(time.RFC3339),
		}

		for key, value := range updates {
			if key == "id" || key == "created_at" {
				continue // immutable fields
			}
			clause := fmt.Sprintf("a.%s = $update_%s", key, key)
			setClauses = append(setClauses, clause)

			if key == "config" {
				configJSON, err := json.Marshal(value)
				if err != nil {
					return nil, fmt.Errorf("failed to marshal config: %w", err)
				}
				params["update_"+key] = string(configJSON)
			} else {
				params["update_"+key] = value
			}
		}

		query := fmt.Sprintf(
			"MATCH (a:Agent {id: $id}) SET %s RETURN a.id",
			joinConditions(setClauses, ", "),
		)

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			return result.Record().Values[0], nil
		}
		return nil, fmt.Errorf("agent %s not found", id)
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to update agent %s: %w", id, err)
	}
	return nil
}

// DeleteAgent removes an agent and all associated conversations from the database.
func (s *Service) DeleteAgent(ctx context.Context, id string) error {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (a:Agent {id: $id})
			OPTIONAL MATCH (a)-[:HAS_CONVERSATION]->(c:Conversation)
			OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
			DETACH DELETE m, c, a
			RETURN count(a) AS deleted
		`
		result, err := tx.Run(ctx, query, map[string]any{"id": id})
		if err != nil {
			return nil, err
		}

		record, err := result.Single(ctx)
		if err != nil {
			return nil, err
		}

		deleted, _ := record.Get("deleted")
		if deleted.(int64) == 0 {
			return nil, fmt.Errorf("agent %s not found", id)
		}
		return deleted, nil
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to delete agent %s: %w", id, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Conversation Operations
// ---------------------------------------------------------------------------

// CreateConversation creates a new conversation session for an agent.
func (s *Service) CreateConversation(ctx context.Context, conv *Conversation) error {
	if conv.ID == "" {
		return fmt.Errorf("agentdb: conversation ID is required")
	}
	if conv.AgentID == "" {
		return fmt.Errorf("agentdb: agent ID is required")
	}

	now := time.Now().UTC()
	conv.CreatedAt = now
	conv.UpdatedAt = now

	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (a:Agent {id: $agent_id})
			MERGE (c:Conversation {id: $id})
			SET c.user_id = $user_id,
			    c.title = $title,
			    c.created_at = datetime($created_at),
			    c.updated_at = datetime($updated_at)
			MERGE (a)-[:HAS_CONVERSATION]->(c)
			RETURN c.id
		`
		params := map[string]any{
			"id":         conv.ID,
			"agent_id":   conv.AgentID,
			"user_id":    conv.UserID,
			"title":      conv.Title,
			"created_at": conv.CreatedAt.Format(time.RFC3339),
			"updated_at": conv.UpdatedAt.Format(time.RFC3339),
		}
		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}
		return result.Single(ctx)
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to create conversation: %w", err)
	}
	return nil
}

// GetConversations retrieves all conversations for a given agent.
func (s *Service) GetConversations(ctx context.Context, agentID string, limit int) ([]*Conversation, error) {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (a:Agent {id: $agent_id})-[:HAS_CONVERSATION]->(c:Conversation)
			RETURN c ORDER BY c.updated_at DESC
			LIMIT $limit
		`
		result, err := tx.Run(ctx, query, map[string]any{
			"agent_id": agentID,
			"limit":    int64(limit),
		})
		if err != nil {
			return nil, err
		}

		conversations := []*Conversation{}
		for result.Next(ctx) {
			record := result.Record()
			node, ok := record.Get("c")
			if !ok {
				continue
			}
			conv, err := nodeToConversation(node.(neo4j.Node))
			if err != nil {
				return nil, err
			}
			conversations = append(conversations, conv)
		}
		return conversations, result.Err()
	})

	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to get conversations: %w", err)
	}

	return result.([]*Conversation), nil
}

// ---------------------------------------------------------------------------
// Message Operations
// ---------------------------------------------------------------------------

// AddMessage appends a message to a conversation.
func (s *Service) AddMessage(ctx context.Context, msg *Message) error {
	if msg.ID == "" {
		return fmt.Errorf("agentdb: message ID is required")
	}
	if msg.ConversationID == "" {
		return fmt.Errorf("agentdb: conversation ID is required")
	}

	msg.Timestamp = time.Now().UTC()

	session := s.newSession(ctx)
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (c:Conversation {id: $conversation_id})
			MERGE (m:Message {id: $id})
			SET m.role = $role,
			    m.content = $content,
			    m.timestamp = datetime($timestamp),
			    m.token_count = $token_count
			MERGE (c)-[:HAS_MESSAGE]->(m)
			SET c.updated_at = datetime($timestamp)
			RETURN m.id
		`
		params := map[string]any{
			"id":              msg.ID,
			"conversation_id": msg.ConversationID,
			"role":            msg.Role,
			"content":         msg.Content,
			"timestamp":       msg.Timestamp.Format(time.RFC3339),
			"token_count":     int64(msg.TokenCount),
		}
		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}
		return result.Single(ctx)
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to add message: %w", err)
	}
	return nil
}

// GetMessages retrieves messages from a conversation in chronological order.
func (s *Service) GetMessages(ctx context.Context, conversationID string, limit int) ([]*Message, error) {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (c:Conversation {id: $conversation_id})-[:HAS_MESSAGE]->(m:Message)
			RETURN m ORDER BY m.timestamp ASC
			LIMIT $limit
		`
		result, err := tx.Run(ctx, query, map[string]any{
			"conversation_id": conversationID,
			"limit":           int64(limit),
		})
		if err != nil {
			return nil, err
		}

		messages := []*Message{}
		for result.Next(ctx) {
			record := result.Record()
			node, ok := record.Get("m")
			if !ok {
				continue
			}
			msg, err := nodeToMessage(node.(neo4j.Node))
			if err != nil {
				return nil, err
			}
			messages = append(messages, msg)
		}
		return messages, result.Err()
	})

	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to get messages: %w", err)
	}

	return result.([]*Message), nil
}

// ---------------------------------------------------------------------------
// Knowledge Graph Operations
// ---------------------------------------------------------------------------

// LinkTopic links an agent to a topic in the knowledge graph.
func (s *Service) LinkTopic(ctx context.Context, agentID, topicID, relationship string) error {
	if relationship == "" {
		relationship = "RELATED_TO"
	}

	session := s.newSession(ctx)
	defer session.Close(ctx)

	query := fmt.Sprintf(`
		MATCH (a:Agent {id: $agent_id})
		MATCH (t:Topic {id: $topic_id})
		MERGE (a)-[r:%s]->(t)
		SET r.linked_at = datetime($linked_at)
		RETURN r
	`, relationship)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		result, err := tx.Run(ctx, query, map[string]any{
			"agent_id":  agentID,
			"topic_id":  topicID,
			"linked_at": time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			return nil, err
		}
		return result.Single(ctx)
	})

	if err != nil {
		return fmt.Errorf("agentdb: failed to link agent %s to topic %s: %w", agentID, topicID, err)
	}
	return nil
}

// GetAgentTopics retrieves topics linked to an agent.
func (s *Service) GetAgentTopics(ctx context.Context, agentID string, limit int) ([]map[string]any, error) {
	session := s.newSession(ctx)
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		query := `
			MATCH (a:Agent {id: $agent_id})-[r]->(t:Topic)
			RETURN t.id AS id, t.name AS name, t.category AS category,
			       type(r) AS relationship, r.linked_at AS linked_at
			ORDER BY r.linked_at DESC
			LIMIT $limit
		`
		result, err := tx.Run(ctx, query, map[string]any{
			"agent_id": agentID,
			"limit":    int64(limit),
		})
		if err != nil {
			return nil, err
		}

		topics := []map[string]any{}
		for result.Next(ctx) {
			record := result.Record()
			topic := map[string]any{
				"id":           record.Values[0],
				"name":         record.Values[1],
				"category":     record.Values[2],
				"relationship": record.Values[3],
				"linked_at":    record.Values[4],
			}
			topics = append(topics, topic)
		}
		return topics, result.Err()
	})

	if err != nil {
		return nil, fmt.Errorf("agentdb: failed to get agent topics: %w", err)
	}

	return result.([]map[string]any), nil
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

func (s *Service) newSession(ctx context.Context) neo4j.SessionWithContext {
	return s.driver.NewSession(ctx, neo4j.SessionConfig{
		DatabaseName: s.database,
	})
}

func nodeToAgent(node neo4j.Node) (*Agent, error) {
	props := node.Props

	agent := &Agent{
		ID:          stringProp(props, "id"),
		Name:        stringProp(props, "name"),
		Description: stringProp(props, "description"),
		Type:        stringProp(props, "type"),
		Active:      boolProp(props, "active"),
	}

	if createdAt, ok := props["created_at"].(neo4j.Time); ok {
		agent.CreatedAt = createdAt.Time()
	}
	if updatedAt, ok := props["updated_at"].(neo4j.Time); ok {
		agent.UpdatedAt = updatedAt.Time()
	}

	if configStr := stringProp(props, "config"); configStr != "" {
		if err := json.Unmarshal([]byte(configStr), &agent.Config); err != nil {
			agent.Config = map[string]string{}
		}
	}

	return agent, nil
}

func nodeToConversation(node neo4j.Node) (*Conversation, error) {
	props := node.Props

	conv := &Conversation{
		ID:      stringProp(props, "id"),
		AgentID: stringProp(props, "agent_id"),
		UserID:  stringProp(props, "user_id"),
		Title:   stringProp(props, "title"),
	}

	if createdAt, ok := props["created_at"].(neo4j.Time); ok {
		conv.CreatedAt = createdAt.Time()
	}
	if updatedAt, ok := props["updated_at"].(neo4j.Time); ok {
		conv.UpdatedAt = updatedAt.Time()
	}

	return conv, nil
}

func nodeToMessage(node neo4j.Node) (*Message, error) {
	props := node.Props

	msg := &Message{
		ID:             stringProp(props, "id"),
		ConversationID: stringProp(props, "conversation_id"),
		Role:           stringProp(props, "role"),
		Content:        stringProp(props, "content"),
		TokenCount:     int(int64Prop(props, "token_count")),
	}

	if timestamp, ok := props["timestamp"].(neo4j.Time); ok {
		msg.Timestamp = timestamp.Time()
	}

	return msg, nil
}

func stringProp(props map[string]any, key string) string {
	if v, ok := props[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func boolProp(props map[string]any, key string) bool {
	if v, ok := props[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func int64Prop(props map[string]any, key string) int64 {
	if v, ok := props[key]; ok {
		if i, ok := v.(int64); ok {
			return i
		}
	}
	return 0
}

func joinConditions(conditions []string, separator string) string {
	if len(conditions) == 0 {
		return ""
	}
	result := conditions[0]
	for i := 1; i < len(conditions); i++ {
		result += separator + conditions[i]
	}
	return result
}
