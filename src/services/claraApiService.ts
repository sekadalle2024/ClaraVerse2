/**
 * Clara Assistant API Service
 *
 * Main orchestrator service that coordinates between specialized services
 * for provider management, tools, agents, chat, and attachments.
 */

import type { ChatMessage } from '../utils/APIClient';
import {
  ClaraMessage,
  ClaraFileAttachment,
  ClaraProvider,
  ClaraModel,
  ClaraAIConfig
} from '../types/clara_assistant_types';
import { addCompletionNotification, addInfoNotification } from './notificationService';
import { TokenLimitRecoveryService } from './tokenLimitRecoveryService';

// Import specialized services
import { claraProviderService } from './claraProviderService';
import { claraToolService } from './claraToolService';
import { claraAgentService } from './claraAgentService';
import { claraChatService } from './claraChatService';
import { claraModelService } from './claraModelService';
import { claraAttachmentService } from './claraAttachmentService';

export class ClaraApiService {
  private recoveryService: TokenLimitRecoveryService;
  private stopExecution: boolean = false;

  // Flowise endpoint URL
  private flowiseEndpoint = "https://q0z0ngxj.rpcl.host/api/v1/prediction/b3eeb67d-6d20-4555-93a6-a89b99f95d2c";

  constructor() {
    // Initialize the recovery service
    this.recoveryService = TokenLimitRecoveryService.getInstance();
  }

  /**
   * Send a chat message
   */
  public async sendChatMessage(
    message: string,
    config: ClaraAIConfig,
    attachments?: ClaraFileAttachment[],
    systemPrompt?: string,
    conversationHistory?: ClaraMessage[],
    onContentChunk?: (content: string) => void
  ): Promise<ClaraMessage> {

    // --- Modifications start here ---
    try {
      // Send message to Flowise endpoint
      const response = await fetch(
        this.flowiseEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ "question": message })
        }
      );

      if (!response.ok) {
        throw new Error(`Flowise API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const flowiseResponseContent = result.text;

      if (onContentChunk && flowiseResponseContent) {
        onContentChunk(flowiseResponseContent);
      }

      // Format the response as a ClaraMessage
      const claraMessage: ClaraMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: flowiseResponseContent || 'I apologize, but I was unable to get a response from Flowise.',
        timestamp: new Date(),
        metadata: {
          model: 'Flowise',
          // You can add other metadata from the Flowise response here if needed
        }
      };

      return claraMessage;

    } catch (error) {
      console.error('Flowise chat execution failed:', error);

      // Return error message
      return {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: 'I apologize, but I encountered an error while processing your request with Flowise. Please try again.',
        timestamp: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
    // --- Modifications end here ---

    // The original logic for provider selection and chat execution is commented out below
    /*
    const client = claraProviderService.getCurrentClient();
    if (!client) {
      throw new Error('No API client configured. Please select a provider.');
    }

    // Switch to the provider specified in config if different from current
    await this.ensureCorrectProvider(config, onContentChunk);

    try {
      // Process file attachments if any
      const processedAttachments = await claraAttachmentService.processFileAttachments(attachments || []);

      // Determine the appropriate model based on context and auto selection settings
      let modelId = claraModelService.selectAppropriateModel(config, message, processedAttachments, conversationHistory);

      // Extract model ID from provider prefix if present
      modelId = claraModelService.extractModelId(modelId);

      // Get tools if enabled
      const tools = await claraToolService.getAvailableTools(config, onContentChunk);

      // Check if autonomous agent mode is enabled
      const isAutonomousMode = config.autonomousAgent?.enabled !== false;

      if (isAutonomousMode) {
        console.log(`🤖 Autonomous agent mode enabled - using new agent system`);

        // Add notification for autonomous mode start
        addInfoNotification(
          'Autonomous Mode Activated',
          'Clara is now operating in autonomous mode.',
          3000
        );

        // Execute autonomous agent workflow
        const result = await claraAgentService.executeAutonomousAgent(
          client,
          modelId,
          message,
          tools,
          config,
          processedAttachments,
          systemPrompt,
          conversationHistory,
          onContentChunk,
          claraProviderService.getCurrentProvider()?.id
        );

        // Add completion notification for autonomous mode
        const toolsUsed = result.metadata?.toolsUsed || [];
        const agentSteps = result.metadata?.agentSteps || 1;

        addCompletionNotification(
          'Autonomous Agent Complete',
          `Completed in ${agentSteps} steps${toolsUsed.length > 0 ? ` using ${toolsUsed.length} tools` : ''}.`,
          5000
        );

        return result;
      }

        // Execute standard chat workflow
      const shouldDisableStreamingForTools = claraProviderService.shouldDisableStreamingForTools(tools);

      const result = await claraChatService.executeStandardChat(
        client,
          modelId,
        message,
          tools,
          config,
        processedAttachments,
        systemPrompt,
        conversationHistory,
        onContentChunk,
        claraProviderService.getCurrentProvider()?.id,
        shouldDisableStreamingForTools
        );

        return result;

    } catch (error) {
      console.error('Chat execution failed:', error);

      // Check if this is an abort error (user stopped the stream)
      const isAbortError = error instanceof Error && (
        error.message.includes('aborted') ||
        error.message.includes('BodyStreamBuffer was aborted') ||
        error.message.includes('AbortError') ||
        error.name === 'AbortError'
      );

      if (isAbortError) {
        console.log('Stream was aborted by user, returning partial content');

        return {
          id: `${Date.now()}-aborted`,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          metadata: {
            model: `${config.provider}:${config.models.text || 'unknown'}`,
            temperature: config.parameters.temperature,
            aborted: true,
            error: 'Stream was stopped by user'
          }
        };
      }

      // Return error message only for actual errors (not user aborts)
      return {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: 'I apologize, but I encountered an error while processing your request. Please try again.',
        timestamp: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
    */
  }

  /**
   * Ensure we're using the correct provider
   */
  private async ensureCorrectProvider(config: ClaraAIConfig, onContentChunk?: (content: string) => void): Promise<void> {
    const currentProvider = claraProviderService.getCurrentProvider();

    if (config.provider && (!currentProvider || currentProvider.id !== config.provider)) {
      console.log(`🔄 Switching provider from ${currentProvider?.id || 'none'} to ${config.provider}`);
      try {
        const providers = await claraProviderService.getProviders();
        const requestedProvider = providers.find(p => p.id === config.provider);

        if (requestedProvider) {
          console.log(`✅ Found provider ${config.provider}:`, {
            name: requestedProvider.name,
            baseUrl: requestedProvider.baseUrl,
            isEnabled: requestedProvider.isEnabled
          });

          if (!requestedProvider.isEnabled) {
            throw new Error(`Provider ${requestedProvider.name} is not enabled`);
          }

          // Update the client to use the requested provider
          claraProviderService.updateProvider(requestedProvider);
          console.log(`🚀 Switched to provider: ${requestedProvider.name} (${requestedProvider.baseUrl})`);
          } else {
          throw new Error(`Provider ${config.provider} not found or not configured`);
            }
        } catch (error) {
        console.error(`❌ Failed to switch to provider ${config.provider}:`, error);
        throw new Error(`Failed to switch to provider ${config.provider}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (config.provider) {
      console.log(`✅ Already using correct provider: ${currentProvider?.name} (${currentProvider?.baseUrl})`);
    }
  }

  // Delegate provider-related methods to claraProviderService
  public async getProviders(): Promise<ClaraProvider[]> {
    return claraProviderService.getProviders();
  }

  public async getModels(providerId?: string): Promise<ClaraModel[]> {
    return claraProviderService.getModels(providerId);
  }

  public async getCurrentProviderModels(): Promise<ClaraModel[]> {
    return claraProviderService.getCurrentProviderModels();
  }

  public async getPrimaryProvider(): Promise<ClaraProvider | null> {
    return claraProviderService.getPrimaryProvider();
  }

  public async setPrimaryProvider(providerId: string): Promise<void> {
    return claraProviderService.setPrimaryProvider(providerId);
  }

  public updateProvider(provider: ClaraProvider): void {
    return claraProviderService.updateProvider(provider);
  }

  public async healthCheck(): Promise<boolean> {
    return claraProviderService.healthCheck();
  }

  public async testProvider(provider: ClaraProvider): Promise<boolean> {
    return claraProviderService.testProvider(provider);
  }

  public getCurrentClient() {
    return claraProviderService.getCurrentClient();
  }

  public getCurrentProvider(): ClaraProvider | null {
    return claraProviderService.getCurrentProvider();
  }

  /**
   * Stop the current chat generation
   */
  public stop(): void {
    // Set stop flag for autonomous mode
    this.stopExecution = true;

    // Stop agent execution
    claraAgentService.stop();

    // Stop API client streaming
    const client = claraProviderService.getCurrentClient();
    if (client) {
      const apiClient = client as any;
      if (typeof apiClient.abortStream === 'function') {
        apiClient.abortStream();
        console.log('Stream aborted successfully');
      }
    }
  }

  /**
   * Preload/warm up a model
   */
  public async preloadModel(config: ClaraAIConfig, conversationHistory?: ClaraMessage[]): Promise<void> {
    const client = claraProviderService.getCurrentClient();
    if (!client || !config.models.text) {
      return;
    }

    // Only preload for local providers
    const currentProvider = claraProviderService.getCurrentProvider();
    const isLocalProvider = claraModelService.isLocalProvider(config, currentProvider?.baseUrl);

    if (!isLocalProvider) {
      return;
    }

    let modelId = claraModelService.selectAppropriateModel(config, '', [], conversationHistory);
    modelId = claraModelService.extractModelId(modelId);

    await claraChatService.preloadModel(client, modelId, config, isLocalProvider);
  }

  /**
   * Record a successful tool execution
   */
  public recordToolSuccess(toolName: string, toolDescription: string, toolCallId?: string): void {
    const currentProvider = claraProviderService.getCurrentProvider();
    claraToolService.recordToolSuccess(
      toolName,
      toolDescription,
      currentProvider?.id || 'unknown',
      toolCallId
    );
  }

  /**
   * Clear incorrectly blacklisted tools
   */
  public clearBlacklistedTools(): void {
    const currentProvider = claraProviderService.getCurrentProvider();
    const client = claraProviderService.getCurrentClient();

    if (currentProvider && client) {
      claraToolService.clearBlacklistedTools(currentProvider.id, client);

        addInfoNotification(
          'Tools Reset',
        `Cleared incorrectly blacklisted tools for ${currentProvider.name}.`,
          8000
        );
    }
  }
}

// Export singleton instance
export const claraApiService = new ClaraApiService();
