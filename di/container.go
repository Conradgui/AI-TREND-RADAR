// Package di provides dependency injection container for the application.
// It wires together all service dependencies and provides a centralized
// way to initialize and access services.
package di

import (
	"context"
	"fmt"
	"log"

	"github.com/conradgui/ai-topic-radar/services/agentdb"
)

// Container holds all application service dependencies.
type Container struct {
	AgentDB *agentdb.Service
}

// Config holds the full application configuration.
type Config struct {
	AgentDB agentdb.Config `yaml:"agentdb"`
}

// NewContainer creates a new dependency injection container with all
// services initialized from the provided configuration.
func NewContainer(ctx context.Context, cfg Config) (*Container, error) {
	// Initialize AgentDB service
	agentDBSvc, err := agentdb.NewService(cfg.AgentDB)
	if err != nil {
		return nil, fmt.Errorf("di: failed to initialize AgentDB service: %w", err)
	}

	// Verify database connectivity
	if err := agentDBSvc.Ping(ctx); err != nil {
		agentDBSvc.Close(ctx)
		return nil, fmt.Errorf("di: AgentDB ping failed: %w", err)
	}

	log.Println("di: all services initialized successfully")

	return &Container{
		AgentDB: agentDBSvc,
	}, nil
}

// NewContainerWithDriver creates a container with an existing Neo4j driver.
// Useful for testing or when sharing a driver across services.
func NewContainerWithDriver(driver interface{ Close(context.Context) error }, database string) *Container {
	// This is a simplified version for testing
	return &Container{}
}

// Close gracefully shuts down all services in the container.
func (c *Container) Close(ctx context.Context) error {
	var errs []error

	if c.AgentDB != nil {
		if err := c.AgentDB.Close(ctx); err != nil {
			errs = append(errs, fmt.Errorf("agentdb close: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("di: errors during shutdown: %v", errs)
	}

	log.Println("di: all services shut down successfully")
	return nil
}
