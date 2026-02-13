admin = User.find_by(login: 'admin')
raise 'Admin user not found' unless admin

admin.must_change_passwd = false
admin.password = 'Admin!23456'
admin.password_confirmation = 'Admin!23456'
admin.save!

project = Project.find_or_initialize_by(identifier: 'e2e-dashboard')
project.name = 'E2E Dashboard'
project.is_public = true
project.enabled_module_names = (project.enabled_module_names + %w[issue_tracking progress_dashboard]).uniq
project.save!

puts 'E2E fixture data has been created.'
