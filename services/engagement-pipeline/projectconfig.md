# Refex Adoption User Report — Project Configuration

## Kissflow
- App Name: IT Service Management
- App ID: IT_Service_Management_A00
- Process Name: Live IT Service Request
- Process ID: Live_IT_Service_Request_A00
- Base URL: https://development-refexgroup.kissflow.com
- Authentication Type: Developer API
- Developer Key ID: (stored in Secret Manager — NOT here)
- Developer Secret: (stored in Secret Manager — NOT here)

## GCP
- Project ID: master-diorama-489103-u2
- Project Number: 645830234926
- Region: asia-south1
- Artifact Registry Location: asia-south1
- Timezone: Asia/Kolkata

## Scheduler
- Frequency: Daily 09:00 AM IST
- Timezone: Asia/Kolkata
- Recipients: dynamic — resolved to each user's manager (NOT hardcoded)

## Report
- Email Subject: Kissflow - User Signin Report
- Branding: Refex logo, corporate colors
- Color Theme: White/Off-white
- Metrics: Assigned Users, Active Users, Sign-in %, Assigned Tickets, Pending Tickets, Pending Ratio
