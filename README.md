## Security Review

### `auth-actions.ts`

- **Input Validation**  
  - Issue: Login and register form data lack validation, risking SQL injection and XSS.  
  - Solution: Use **Zod** schemas to validate all fields.  

- **Error Messages**  
  - Issue: Specific error messages expose details attackers could exploit.  
  - Solution: Use **generic error messages** in production.  

- **Rate Limiting**  
  - Issue: Unlimited login attempts enable brute-force attacks.  
  - Solution: Implement a cap on failed login attempts within a time window.  


### `poll-action.ts`

- **Input Validation**  
  - Issue: Questions and options not validated (XSS, long strings → DoS).  
  - Issue: No validation for `id`, `pollId`, or `optionIndex`.  
  - Solution:  
    - Enforce min/max length for questions and options.  
    - Validate IDs (`pollId` as UUID, `optionIndex` as valid index).  

- **Error Handling**  
  - Issue: Error messages reveal too much detail.  
  - Solution: Return **generic error messages**, log detailed ones server-side.  

- **Authorization**  
  - **No Row-Level Security**  
    - Issue: Any user can access any poll by ID.  
    - Solution: Add **RLS policies** in Supabase to restrict access.  
  - **Vote Duplication**  
    - Issue: Users can vote multiple times.  
    - Solution: Check if `user_id` already voted for a `poll_id` before inserting.  
  - **Missing Owner Check**  
    - Issue: Any user can delete any poll.  
    - Solution: Ensure poll deletion checks the **owner (`user.id`)**.  

- **Rate Limiting**  
  - Issue: Unlimited poll creation, update, delete → abuse.  
  - Solution: Add caps on poll actions per user per timeframe.  

### `polls/page.tsx`

- **Client-Side Error Handling**  
  - Issue: Errors like *“poll.user_id does not exist”* are exposed in UI.  
  - Solution: Do not display raw errors in production; log server-side instead.  
